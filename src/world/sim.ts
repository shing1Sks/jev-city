import { createCast } from "./cast.js";
import { pathTo, placeOf } from "./map.js";
import { reflexDecide } from "./reflex.js";
import { forcedAction, isDistressed, legalActions, skillFor } from "./rules.js";
import { sanitizeSpeech, whoHears } from "./speech.js";
import type {
  ActionOption,
  CityEvent,
  Decision,
  Person,
  PlaceId,
  PublicPerson,
  PublicState,
  Skill,
  World,
} from "./types.js";
import { HOP_TICKS, SKILLS, bondKey, clamp, clockLabel, phaseOf } from "./types.js";

const WEATHERS = ["clear", "clear", "cloudy", "rain", "wind", "clear"] as const;

function parkAtHome(people: Person[]): void {
  const seen = new Map<string, number>();
  for (const person of people) {
    const index = seen.get(person.home) ?? 0;
    seen.set(person.home, index + 1);
    const spot = placeOf(person.home);
    const angle = index * 1.4;
    person.x = spot.x + Math.cos(angle) * 1.8;
    person.y = spot.y + Math.sin(angle) * 1.2;
    person.facing = "front";
  }
}

export function createWorld(): World {
  const cast = createCast();
  parkAtHome(cast.people);
  return {
    tick: 0,
    hour: 7,
    minute: 0,
    phase: "day",
    weather: "clear",
    food: cast.food,
    people: cast.people,
    bonds: cast.bonds,
    log: [],
    nextEventId: 1,
    chronicle: "",
    chronicleAt: null,
    story: {
      headline: "Morning in JEV City",
      body: "Ten people are awake with plans of their own. The field, the hearth, the loft, and the grove can still change if they keep at the work they love.",
      gossip: ["Nothing scandalous yet. The day is young."],
      at: null,
    },
    expansions: [],
    uncompiled: 0,
    soul: {
      mode: "reflex",
      configured: false,
      lastError: null,
      lastModel: null,
      inFlight: false,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    gemini: {
      configured: false,
      status: "off",
      lastError: null,
      calls: 0,
      model: "gpt-6-luna",
    },
  };
}

export function setClock(world: World, hour: number, minute: number): void {
  world.hour = ((hour % 24) + 24) % 24;
  world.minute = Math.max(0, Math.min(59, minute));
  world.phase = phaseOf(world.hour);
}

export function tick(world: World, mode: "reflex" | "open" = "reflex"): string[] {
  advanceClock(world);
  decay(world);
  for (const person of world.people) applyLaw(world, person);
  for (const person of world.people) progress(world, person);
  const deciders = world.people.filter((person) => person.intent === null).map((person) => person.id);
  if (mode === "reflex") {
    for (const id of deciders) applyDecision(world, reflexDecide(world, id));
    return [];
  }
  return deciders;
}

export function applyDecision(world: World, decision: Decision): void {
  const person = world.people.find((item) => item.id === decision.personId);
  if (!person || person.intent) return;
  const forced = forcedAction(person, world);
  const options = forced ? [forced] : legalActions(person, world);
  const option = options.find((item) => item.id === decision.actionId) ?? options[0];
  if (!option) return;
  const speech = sanitizeSpeech(person, world, decision, option);
  if (speech.speak && speech.utterance) say(world, person, speech.audience, speech.listenerId, speech.utterance.text);
  person.intent = makeIntent(person, world, option);
  person.because = decision.because;
}

function advanceClock(world: World): void {
  world.minute += 10;
  let hourChanged = false;
  if (world.minute >= 60) {
    world.minute -= 60;
    world.hour = (world.hour + 1) % 24;
    hourChanged = true;
    if (world.hour === 5) {
      for (const person of world.people) person.choresToday = 0;
    }
  }
  world.tick += 1;
  world.phase = phaseOf(world.hour);
  if (hourChanged && [8, 13, 19].includes(world.hour)) {
    pushEvent(world, { kind: "meal", speakerId: null, audience: "town", listenerId: null, place: "hearth", text: "Meal time at the hearth.", heardBy: world.people.map((person) => person.id) });
  }
  if (hourChanged && world.hour % 4 === 0) {
    const next = WEATHERS[Math.floor(world.tick / 24) % WEATHERS.length] ?? "clear";
    if (next !== world.weather) {
      world.weather = next;
      pushEvent(world, { kind: "weather", speakerId: null, audience: "town", listenerId: null, place: null, text: `The weather turns ${next}.`, heardBy: world.people.map((person) => person.id) });
      world.uncompiled += 1;
    }
  }
}

function decay(world: World): void {
  for (const person of world.people) {
    person.hunger = clamp(person.hunger + 0.4, 0, 100);
    let drain = 0.12;
    if (world.weather === "rain" && !placeOf(person.place).shelter) drain += 0.45;
    if (world.phase === "night" && person.intent?.kind !== "sleep") drain += 0.2;
    person.energy = clamp(person.energy - drain, 0, 100);
    person.belonging = clamp(person.belonging - 0.04, 0, 100);
    if (person.speech) {
      person.speech.ticks -= 1;
      if (person.speech.ticks <= 0) person.speech = null;
    }
  }
  for (const person of world.people) person.distress = isDistressed(person, world);
}

function applyLaw(world: World, person: Person): void {
  const forced = forcedAction(person, world);
  if (!forced) return;
  if (person.intent?.actionId === forced.id) return;
  const speech = forced.id === "cry"
    ? sanitizeSpeech(person, world, { speak: true, audience: "here", listenerId: null, intentWord: "need", topic: "help", tone: "fear" }, forced)
    : null;
  if (speech?.speak && speech.utterance) say(world, person, speech.audience, speech.listenerId, speech.utterance.text);
  person.intent = makeIntent(person, world, forced);
  person.because = forced.id === "cry" ? "law: left without a guardian" : forced.escort ? "law: bringing the child home" : "law: the child, or curfew";
  pushEvent(world, {
    kind: "law",
    speakerId: person.id,
    audience: null,
    listenerId: null,
    place: person.place,
    text: `${person.name}: ${person.because}.`,
    heardBy: [],
  });
}

function makeIntent(person: Person, world: World, action: ActionOption): Person["intent"] {
  if (action.kind === "go" && action.place) {
    const path = pathTo(person.place, action.place);
    return {
      actionId: action.id,
      kind: "go",
      place: action.place,
      path,
      wait: path.length > 0 ? HOP_TICKS : 1,
      escort: action.escort,
    };
  }
  const waits: Partial<Record<ActionOption["kind"], number>> = {
    eat: 6,
    rest: 8,
    sleep: 16,
    speak: 5,
    play: 10,
    care: 8,
    stay: 6,
  };
  return {
    actionId: action.id,
    kind: action.kind,
    place: action.place,
    path: [],
    wait: action.id === "cry" ? 8 : waits[action.kind] ?? 12,
    escort: false,
  };
}

function progress(world: World, person: Person): void {
  const intent = person.intent;
  if (!intent) return;
  if (intent.kind === "go") {
    const next = intent.path[0];
    if (!next || (next === person.place && Math.hypot(placeOf(next).x - person.x, placeOf(next).y - person.y) < 1.4)) {
      finish(world, person, "go");
      return;
    }
    const target = placeOf(next);
    const dx = target.x - person.x;
    const dy = target.y - person.y;
    const distance = Math.hypot(dx, dy);
    const speed = walkSpeed(person);
    if (distance <= Math.max(1.3, speed)) {
      const from = person.place;
      person.x = target.x;
      person.y = target.y;
      person.place = next;
      intent.path.shift();
      if (intent.escort) escort(world, person, from);
      if (intent.path.length === 0) finish(world, person, "go");
      return;
    }
    person.x += (dx / distance) * speed;
    person.y += (dy / distance) * speed;
    person.facing = faceOf(dx, dy);
    if (intent.escort) pullToddlers(world, person);
    return;
  }
  if (intent.wait > 1) {
    intent.wait -= 1;
    return;
  }
  finish(world, person, intent.kind);
}

function walkSpeed(person: Person): number {
  if (person.band === "elder") return 4.2;
  if (person.band === "child") return 5.2;
  if (person.band === "youth") return 6.2;
  if (person.band === "toddler") return 3.4;
  return 7.4;
}

function faceOf(dx: number, dy: number): Person["facing"] {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "front" : "back";
}

function pullToddlers(world: World, person: Person): void {
  for (const kid of world.people) {
    if (kid.band === "toddler" && kid.household === person.household && kid.place === person.place) {
      kid.x = person.x + 1.4;
      kid.y = person.y + 0.8;
      kid.facing = person.facing;
    }
  }
}

function escort(world: World, person: Person, from: PlaceId): void {
  for (const kid of world.people) {
    if (kid.band === "toddler" && kid.household === person.household && kid.place === from) {
      kid.place = person.place;
      kid.x = person.x + 1.4;
      kid.y = person.y + 0.8;
      kid.facing = person.facing;
      kid.intent = null;
      kid.because = `with ${person.name}`;
    }
  }
}

function finish(world: World, person: Person, kind: ActionOption["kind"]): void {
  const household = person.household;
  const addFood = (amount: number) => {
    world.food[household] = clamp((world.food[household] ?? 0) + amount, 0, 24);
  };
  switch (kind) {
    case "eat":
      if ((world.food[household] ?? 0) > 0) {
        world.food[household] = (world.food[household] ?? 0) - 1;
        person.hunger = clamp(person.hunger - 55, 0, 100);
        person.belonging = clamp(person.belonging + 4, 0, 100);
      }
      break;
    case "rest":
      person.energy = clamp(person.energy + 18, 0, 100);
      break;
    case "sleep":
      person.energy = clamp(person.energy + 30, 0, 100);
      person.hunger = clamp(person.hunger + 4, 0, 100);
      break;
    case "farm":
      addFood(world.weather === "clear" ? 2 : 1);
      gain(person, "farm");
      person.energy = clamp(person.energy - 8, 0, 100);
      break;
    case "forage":
      addFood(1);
      gain(person, "forage");
      person.energy = clamp(person.energy - 6, 0, 100);
      if (person.band === "child") person.choresToday += 1;
      break;
    case "haul":
      addFood(1);
      gain(person, "haul");
      person.energy = clamp(person.energy - 12, 0, 100);
      break;
    case "cook":
      for (const other of world.people) {
        if (other.place === "hearth") other.hunger = clamp(other.hunger - 10, 0, 100);
      }
      gain(person, "cook");
      person.energy = clamp(person.energy - 5, 0, 100);
      break;
    case "mend":
      gain(person, "mend");
      person.belonging = clamp(person.belonging + 6, 0, 100);
      person.energy = clamp(person.energy - 4, 0, 100);
      break;
    case "heal":
      gain(person, "heal");
      for (const other of world.people) {
        if (other.place === person.place && other.id !== person.id && other.energy < 50) {
          other.energy = clamp(other.energy + 12, 0, 100);
        }
      }
      break;
    case "teach":
      gain(person, "teach");
      for (const other of world.people) {
        if (other.place === person.place && (other.band === "child" || other.band === "youth")) {
          const pull = other.self.pull.map((item) => skillFor(item)).find((item): item is Skill => item !== null);
          gain(other, pull ?? "play");
        }
      }
      break;
    case "learn": {
      const weakest = SKILLS.slice().sort((left, right) => person.skills[left] - person.skills[right])[0];
      if (weakest) gain(person, weakest);
      break;
    }
    case "play":
      gain(person, "play");
      person.belonging = clamp(person.belonging + 8, 0, 100);
      person.energy = clamp(person.energy - 4, 0, 100);
      break;
    case "care": {
      const kid = world.people.find((other) => other.band === "toddler" && other.household === household && other.place === person.place);
      if (kid) {
        kid.hunger = clamp(kid.hunger - 12, 0, 100);
        kid.belonging = clamp(kid.belonging + 14, 0, 100);
        person.belonging = clamp(person.belonging + 6, 0, 100);
      }
      break;
    }
    case "watch":
      person.energy = clamp(person.energy - 6, 0, 100);
      break;
    case "go":
    case "stay":
    case "speak":
      break;
  }
  if (kind !== "stay" && kind !== "speak") {
    const where = kind === "go" ? placeOf(person.place).name : kind;
    remember(world, person, `${kind === "go" ? "GO" : kind.toUpperCase()} ${where}`, false);
    if (kind !== "go") {
      pushEvent(world, {
        kind: "work",
        speakerId: person.id,
        audience: null,
        listenerId: null,
        place: person.place,
        text: `${person.name} ${kind === "eat" ? "eats" : kind === "sleep" ? "sleeps" : `finishes ${kind}`}.`,
        heardBy: [],
      });
    }
  }
  noteProject(world, person, kind);
  person.intent = null;
}

const PROJECT_ACTS: Record<string, string[]> = {
  garden: ["farm", "cook"],
  orchard: ["forage"],
  stall: ["mend", "haul"],
  shrine: ["teach", "learn"],
  watch: ["watch"],
};

function noteProject(world: World, person: Person, kind: ActionOption["kind"]): void {
  const wanted = PROJECT_ACTS[person.self.ambition.project] ?? [];
  if (!wanted.includes(kind)) return;
  if (world.expansions.some((item) => item.ownerId === person.id)) return;
  person.projectProgress += 1;
  if (person.projectProgress < 3) return;
  const home = placeOf(person.home);
  const angle = [...person.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  world.expansions.push({
    id: `${person.id}-${person.self.ambition.project}`,
    ownerId: person.id,
    kind: person.self.ambition.project,
    label: `${person.name}'s ${person.self.ambition.project}`,
    x: clamp(home.x + Math.cos(angle) * 7, 6, 94),
    y: clamp(home.y + Math.sin(angle) * 6, 10, 90),
  });
  pushEvent(world, {
    kind: "work",
    speakerId: person.id,
    audience: "town",
    listenerId: null,
    place: person.home,
    text: `${person.name} makes the ${person.self.ambition.project} their own.`,
    heardBy: world.people.map((item) => item.id),
  });
  world.uncompiled += 1;
}

function gain(person: Person, skill: Skill): void {
  person.skills[skill] = clamp(person.skills[skill] + 1, 0, 100);
}

export function say(world: World, speaker: Person, audience: Decision["audience"], listenerId: string | null, text: string): void {
  const heard = whoHears(world, speaker, audience, listenerId);
  const listener = world.people.find((person) => person.id === listenerId) ?? null;
  const address = audience === "private" && listener
    ? `${speaker.name} → ${listener.name}`
    : audience === "town"
      ? `${speaker.name} announces`
      : `${speaker.name} → here`;
  const line = `${address}: ${text}`;
  speaker.speech = { text, audience, listenerId, ticks: 8 };
  remember(world, speaker, line, audience === "private");
  for (const other of heard) {
    remember(world, other, line, audience === "private");
    const bump = audience === "private" ? 6 : audience === "town" ? 2 : 3;
    other.belonging = clamp(other.belonging + bump, 0, 100);
    if (audience === "private") touchBond(world, speaker.id, other.id, 6);
    else touchBond(world, speaker.id, other.id, audience === "town" ? 1 : 2);
  }
  speaker.belonging = clamp(speaker.belonging + (audience === "private" ? 6 : 4), 0, 100);
  pushEvent(world, {
    kind: "speech",
    speakerId: speaker.id,
    audience,
    listenerId,
    place: speaker.place,
    text: line,
    heardBy: heard.map((person) => person.id),
  });
  world.uncompiled += 1;
}

function remember(world: World, person: Person, text: string, isPrivate: boolean): void {
  person.memory.push({ clock: clockLabel(world.hour, world.minute), text, private: isPrivate });
  if (person.memory.length > 12) person.memory.shift();
}

function touchBond(world: World, a: string, b: string, delta: number): void {
  let bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(a, b));
  if (!bond) {
    bond = { a, b, score: 35, note: "acquainted in town" };
    world.bonds.push(bond);
  }
  bond.score = clamp(bond.score + delta, 0, 100);
}

function pushEvent(world: World, event: Omit<CityEvent, "id" | "tick" | "clock">): void {
  world.log.push({
    id: world.nextEventId,
    tick: world.tick,
    clock: clockLabel(world.hour, world.minute),
    ...event,
  });
  world.nextEventId += 1;
  if (world.log.length > 80) world.log.shift();
}

export function doingOf(person: Person, thinking: boolean): string {
  if (thinking && !person.intent) return "thinking";
  if (!person.intent) return "idle";
  if (person.intent.kind === "go") {
    const next = person.intent.path[0] ?? person.intent.place;
    return next ? `walking to ${placeOf(next).name}` : "arriving";
  }
  if (person.intent.actionId === "cry") return "calling for help";
  return person.intent.kind;
}

function walkOf(person: Person): PublicPerson["walk"] {
  const intent = person.intent;
  const next = intent?.path[0];
  if (!intent || intent.kind !== "go" || !next) return null;
  const target = placeOf(next);
  const distance = Math.hypot(target.x - person.x, target.y - person.y);
  const span = Math.max(distance, walkSpeed(person));
  return {
    from: person.place,
    to: next,
    t: clamp(1 - distance / (span + walkSpeed(person)), 0, 1),
  };
}

function feelingOf(person: Person): PublicPerson["feeling"] {
  if (person.distress) return "afraid";
  if (person.hunger > 62) return "hungry";
  if (person.energy < 32) return "tired";
  if (person.belonging < 34) return "lonely";
  if (person.intent?.kind === "play") return "playing";
  return "content";
}

function ledBy(world: World, person: Person): string | null {
  if (person.band !== "toddler" || person.intent) return null;
  const leader = world.people.find(
    (other) =>
      other.household === person.household &&
      other.intent?.escort === true &&
      other.intent.kind === "go" &&
      other.place === person.place,
  );
  return leader?.id ?? null;
}

export function snapshot(world: World, thinking: ReadonlySet<string> = new Set()): PublicState {
  const people: PublicPerson[] = world.people.map((person) => ({
    id: person.id,
    name: person.name,
    age: person.age,
    gender: person.gender,
    band: person.band,
    household: person.household,
    home: person.home,
    spouse: person.spouse,
    guardians: person.guardians,
    dependents: person.dependents,
    place: person.place,
    x: person.x,
    y: person.y,
    facing: person.facing,
    moving: person.intent?.kind === "go" && person.intent.path.length > 0,
    feeling: feelingOf(person),
    hunger: person.hunger,
    energy: person.energy,
    belonging: person.belonging,
    distress: person.distress,
    mood: person.mood,
    innerNote: person.innerNote,
    because: person.because,
    doing: doingOf(person, thinking.has(person.id)),
    thinking: thinking.has(person.id) && person.intent === null,
    walk: walkOf(person),
    ledBy: ledBy(world, person),
    self: person.self,
    skills: person.skills,
    speech: person.speech,
    memory: person.memory,
  }));
  return {
    tick: world.tick,
    hour: world.hour,
    minute: world.minute,
    clock: clockLabel(world.hour, world.minute),
    phase: world.phase,
    weather: world.weather,
    food: world.food,
    people,
    bonds: world.bonds,
    log: world.log,
    chronicle: world.chronicle,
    chronicleAt: world.chronicleAt,
    story: world.story,
    expansions: world.expansions,
    soul: world.soul,
    gemini: world.gemini,
  };
}

export function renderChronicle(world: World): string {
  const memory = world.chronicle.trim() || world.story.body;
  const people = world.people
    .map((person) => {
      const mood = person.mood.replace(/[. ]+$/g, "");
      const note = person.innerNote.replace(/^[. ]+/g, "");
      return `- **${person.name}** (${person.age}, ${person.band}) — ${mood}. ${note}`;
    })
    .join("\n");
  const bonds = world.bonds
    .slice()
    .sort((left, right) => right.score - left.score)
    .map((bond) => {
      const left = world.people.find((person) => person.id === bond.a)?.name ?? bond.a;
      const right = world.people.find((person) => person.id === bond.b)?.name ?? bond.b;
      return `- ${left} & ${right}: ${bond.score} — ${bond.note}`;
    })
    .join("\n");
  const recent = world.log
    .slice(-30)
    .map((event) => `- ${event.clock} ${event.text}`)
    .join("\n");
  const stamped = world.chronicleAt ? `_Compacted ${world.chronicleAt}._` : "_Raw log. Compaction runs when Gemini is configured._";
  return `# JEV City chronicle\n\n${stamped}\n\n## Town memory\n\n${memory}\n\n## People\n\n${people}\n\n## Bonds\n\n${bonds}\n\n## Recent\n\n${recent || "- The day has just started."}\n`;
}
