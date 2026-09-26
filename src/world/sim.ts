import { tickAnimals } from "./animals.js";
import { createCast } from "./cast.js";
import { foodInStorage, addToCarry, depositCarry, foodInCarry, spendMeal, spendMealFromCarry, withdraw } from "./carry.js";
import { deliverToSite, markSite, raiseStage, siteComplete } from "./construction.js";
import { buildBlockMask, buildTerrain, findPath, nearestOpen, regionAt, terrainAt, type BlockMask } from "./grid.js";
import { renderUtterance } from "./lexicon.js";
import { centerOf, placeOf } from "./map.js";
import { consolidate, storeMemory } from "./memory.js";
import { spawnAnimals } from "./animals.js";
import { cropGrowth, dailyGrowth, deplete, nodeById, scatterNodes, yieldOf } from "./nodes.js";
import { reflexDecide } from "./reflex.js";
import { capableMember, forcedStep, isDistressed, legalSteps, nearHome } from "./rules.js";
import { othersHere, sanitizeSpeech, whoHears } from "./speech.js";
import { tradeAtStalls } from "./trade.js";
import type {
  ActiveStep,
  CityEvent,
  Decision,
  DialogueAct,
  Item,
  Matter,
  PendingDialogue,
  Person,
  PublicPerson,
  PublicState,
  ResourceNode,
  Skill,
  StepOption,
  Vec,
  World,
} from "./types.js";
import { MINUTES_PER_TICK, SKILLS, bandFor, bondKey, carryCapacity, carryCount, clamp, clockLabel, dist, phaseOf, roll } from "./types.js";
import { nextWeather } from "./weather.js";

/**
 * The body: one tick is one in-world minute. Clock, needs, law, movement, and
 * every step's physical effect live here, in plain code. No model is called;
 * decisions arrive through applyDecision (reflex now, the Jev spine in Stage 2).
 */

const TERRAIN = buildTerrain();

let MASK: BlockMask = new Uint8Array(0);

function refreshMask(world: World): void {
  MASK = buildBlockMask(world.nodes);
}

const WORK_TICKS: Partial<Record<ActiveStep["kind"], number>> = {
  chop: 45,
  mine: 50,
  harvest: 22,
  plant: 25,
  build: 60,
  eat: 15,
  rest: 25,
  play: 30,
  care: 20,
  teach: 40,
  learn: 30,
  express: 3,
  store: 8,
  withdraw: 6,
  give: 6,
};

export function createWorld(): World {
  const cast = createCast();
  const world: World = {
    schema: 2,
    tick: 0,
    hour: 7,
    minute: 0,
    phase: "day",
    weather: "clear",
    day: 1,
    solMinutes: 7 * 60,
    needsSummary: false,
    summaryFor: null,
    rng: 20260924,
    storages: cast.storages,
    people: cast.people,
    bonds: cast.bonds,
    nodes: [],
    sites: [],
    animals: [],
    beast: { configured: false, status: "off", lastError: null, calls: 0 },
    log: [],
    nextEventId: 1,
    chronicle: "",
    chronicleAt: null,
    story: { headline: "", body: "", gossip: [], at: null, day: null },
    expansions: [],
    visitors: [],
    visitorLog: [],
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
      costUsd: 0,
      tokensThisHour: 0,
    },
    luna: {
      configured: false,
      status: "off",
      lastError: null,
      calls: 0,
      model: "gpt-6-luna",
    },
    brain: {
      configured: false,
      status: "off",
      lastError: null,
      lastModel: null,
      inFlight: false,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      callsThisHour: 0,
    },
    pendingNames: [],
    dialogue: [],
  };
  world.nodes = scatterNodes(world);
  world.animals = spawnAnimals(world);
  refreshMask(world);
  parkAtHome(world);
  // Jevoss starts with nothing but a marked plot: the rise's first earned build.
  const jevoss = world.people.find((person) => person.id === "jevoss");
  const rise = placeOf("rise");
  if (jevoss) {
    const site = markSite(jevoss, "house", { x: rise.x + 7, y: rise.y - 4 }, 0);
    if (site) world.sites.push(site);
  }
  ensureMatters(world);
  return world;
}

function parkAtHome(world: World): void {
  const seen = new Map<string, number>();
  for (const person of world.people) {
    const index = seen.get(person.home) ?? 0;
    seen.set(person.home, index + 1);
    const spot = placeOf(person.home);
    const angle = index * 1.4;
    const at = nearestOpen(MASK, { x: spot.x + Math.cos(angle) * 2.5, y: spot.y + Math.sin(angle) * 2 });
    person.x = at.x;
    person.y = at.y;
    person.facing = "front";
  }
}

export function setClock(world: World, hour: number, minute: number): void {
  world.hour = ((hour % 24) + 24) % 24;
  world.minute = Math.max(0, Math.min(59, minute));
  world.solMinutes = world.hour * 60 + world.minute;
  world.phase = phaseOf(world.hour);
}

export function tick(world: World, mode: "reflex" | "open" = "reflex"): string[] {
  refreshMask(world);
  advanceClock(world);
  decay(world);
  for (const person of world.people.filter((item) => item.alive)) applyLaw(world, person);
  for (const person of world.people.filter((item) => item.alive)) progress(world, person);
  deliverDialogue(world);
  tickAnimals(world);
  // Barter happens when traders happen to stand together; a sweep every 20 minutes.
  if (world.tick % 20 === 0) tradeAtStalls(world);
  const deciders = world.people.filter((person) => person.alive && person.step === null).map((person) => person.id);
  if (mode === "reflex") {
    for (const id of deciders) applyDecision(world, reflexDecide(world, id));
    return [];
  }
  return deciders;
}

export function applyDecision(world: World, decision: Decision): void {
  const person = world.people.find((item) => item.id === decision.personId);
  if (!person || !person.alive || person.step) return;
  const forced = forcedStep(person, world);
  const options = forced ? [forced] : legalSteps(person, world);
  const option = options.find((item) => item.id === decision.stepId) ?? options[0];
  if (!option) return;
  const speech = sanitizeSpeech(person, world, decision, option);
  if (speech.speak && speech.utterance) say(world, person, speech.audience, speech.listenerId, speech.utterance.text);
  person.step = beginStep(world, person, option);
  person.because = decision.because;
  // Task bookkeeping: the spine keeps a commitment alive across steps (noul drops it).
  if (decision.task?.keep && person.task) {
    person.task.chosen = [...person.task.chosen, option.id].slice(-6);
    const relabel = decision.task.label?.trim();
    if (relabel) person.task.label = relabel.slice(0, 48);
  } else {
    const label = decision.task?.label?.trim();
    person.task = { label: (label || option.label).slice(0, 48), chosen: [option.id], startedTick: world.tick };
  }
}

// ---------------------------------------------------------------- step setup

function skillTime(person: Person, skill: Skill | null, ticks: number): number {
  const level = skill ? person.skills[skill] : 10;
  const factor = clamp(1.25 - 0.005 * level, 0.6, 1.25);
  return Math.max(4, Math.round(ticks * factor));
}

function walkStep(dest: Vec, note: string, then?: ActiveStep, leadId?: string): ActiveStep {
  return { kind: "walk", note, dest: { x: dest.x, y: dest.y }, then, leadId };
}

function workNote(option: StepOption, node: ResourceNode): string {
  if (option.kind === "chop") return "chopping wood";
  if (option.kind === "mine") return "mining stone";
  if (option.kind === "harvest") return node.kind === "crop" ? "harvesting grain" : "picking berries";
  return "sowing the plot";
}

function beginStep(world: World, person: Person, option: StepOption): ActiveStep | null {
  switch (option.kind) {
    case "walk": {
      if (!option.dest) return null;
      const step = walkStep(option.dest, `walking to ${option.place ? placeOf(option.place).name : "a spot"}`, undefined, option.leadId);
      step.toId = option.toId ?? undefined;
      return step;
    }
    case "chop":
    case "mine":
    case "harvest":
    case "plant": {
      const node = option.nodeId ? nodeById(world.nodes, option.nodeId) : null;
      if (!node) return null;
      const skill: Skill | null = option.kind === "plant" || node.kind === "crop" ? "farm" : node.kind === "berry" ? "forage" : "haul";
      const work: ActiveStep = {
        kind: option.kind,
        note: workNote(option, node),
        nodeId: node.id,
        remaining: skillTime(person, skill, WORK_TICKS[option.kind] ?? 20),
      };
      if (dist(person, node) <= 2) return work;
      const approach = nearestOpen(MASK, node);
      const where = node.kind === "tree" ? "the trees" : node.kind === "rock" ? "the rocks" : node.kind === "berry" ? "the bushes" : "the field";
      return walkStep(approach, `walking to ${where}`, work);
    }
    case "store": {
      if (option.siteId) {
        const site = world.sites.find((item) => item.id === option.siteId);
        if (!site) return null;
        const take: ActiveStep = { kind: "withdraw", note: "gathering materials", siteId: site.id, remaining: WORK_TICKS.withdraw };
        const deliver: ActiveStep = { kind: "store", note: `carrying materials to the ${site.kind}`, siteId: site.id, remaining: WORK_TICKS.store };
        const toSite = walkStep(nearestOpen(MASK, site), `walking to the ${site.kind} site`, deliver);
        if (nearHome(person, 4)) return { ...take, then: toSite };
        return walkStep(centerOf(person.home), "walking home for materials", { ...take, then: toSite });
      }
      const work: ActiveStep = { kind: "store", note: "storing goods at home", remaining: WORK_TICKS.store };
      if (nearHome(person, 4)) return work;
      return walkStep(centerOf(person.home), "walking home", work);
    }
    case "build": {
      const site = option.siteId ? world.sites.find((item) => item.id === option.siteId) : null;
      if (!site) return null;
      const work: ActiveStep = {
        kind: "build",
        note: `raising the ${site.kind}`,
        siteId: site.id,
        remaining: skillTime(person, "haul", WORK_TICKS.build ?? 60),
      };
      if (dist(person, site) <= 2.5) return work;
      return walkStep(nearestOpen(MASK, site), `walking to the ${site.kind} site`, work);
    }
    case "eat": {
      const work: ActiveStep = { kind: "eat", note: "eating", remaining: WORK_TICKS.eat };
      if (nearHome(person, 4) || foodInCarry(person.carry) > 0) return work;
      return walkStep(centerOf(person.home), "walking home to eat", work);
    }
    case "sleep": {
      const work: ActiveStep = { kind: "sleep", note: "sleeping" };
      if (nearHome(person, 4)) return work;
      return walkStep(centerOf(person.home), "walking home to sleep", work);
    }
    case "care": {
      const kid = option.toId ? world.people.find((item) => item.id === option.toId && item.alive) : null;
      if (!kid) return null;
      const work: ActiveStep = { kind: "care", note: `caring for ${kid.name}`, toId: kid.id, remaining: WORK_TICKS.care };
      if (dist(person, kid) <= 2) return work;
      return walkStep({ x: kid.x, y: kid.y }, `walking to ${kid.name}`, work);
    }
    case "give": {
      // A promised favor: fetch the goods from home if hands are empty, then
      // walk the hand-over to whoever is owed — the same chain site delivery uses.
      const target = option.toId ? world.people.find((item) => item.id === option.toId && item.alive) : null;
      if (!target || !person.owe) return null;
      const handOver: ActiveStep = { kind: "give", note: `bringing ${person.owe.qty} ${person.owe.item} to ${target.name}`, toId: target.id, remaining: WORK_TICKS.give };
      if ((person.carry[person.owe.item] ?? 0) >= 1) {
        if (dist(person, target) <= 2) return handOver;
        return walkStep({ x: target.x, y: target.y }, `walking to ${target.name}`, handOver);
      }
      const take: ActiveStep = { kind: "withdraw", note: "gathering what was promised", remaining: WORK_TICKS.withdraw };
      const toTarget = walkStep({ x: target.x, y: target.y }, `walking to ${target.name}`, handOver);
      if (nearHome(person, 4)) return { ...take, then: toTarget };
      return walkStep(centerOf(person.home), "walking home for the promised goods", { ...take, then: toTarget });
    }
    case "rest":
      return { kind: "rest", note: "resting", remaining: WORK_TICKS.rest };
    case "play":
      return { kind: "play", note: "playing", remaining: WORK_TICKS.play };
    case "teach":
      return { kind: "teach", note: "teaching", remaining: WORK_TICKS.teach };
    case "learn":
      return { kind: "learn", note: "practicing", remaining: WORK_TICKS.learn };
    case "express":
      return { kind: "express", note: option.id === "cry" ? "calling for help" : "expressing", remaining: WORK_TICKS.express };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- clock

function advanceClock(world: World): void {
  const previousHour = world.hour;
  world.solMinutes += MINUTES_PER_TICK;
  if (world.solMinutes >= 1440) {
    world.summaryFor = world.day;
    world.solMinutes -= 1440;
    world.day += 1;
    world.needsSummary = true;
    ageAndLife(world);
    // Dawn consolidation: last night's repeated episodes fold into beliefs.
    for (const person of world.people) {
      if (person.alive) {
        consolidate(world, person, (aboutId) => {
          feel(world, person.id, aboutId, "rivalry", 3);
        });
      }
    }
    dawnHealth(world);
  }
  world.hour = Math.floor(world.solMinutes / 60) % 24;
  world.minute = world.solMinutes % 60;
  const hourChanged = world.hour !== previousHour;
  world.tick += 1;
  world.phase = phaseOf(world.hour);
  if (hourChanged && world.hour === 5) {
    for (const person of world.people) person.choresToday = 0;
    dailyGrowth(world.nodes, world, world.day);
  }
  if (hourChanged && [8, 13, 19].includes(world.hour)) {
    pushEvent(world, {
      kind: "meal",
      speakerId: null,
      audience: "town",
      listenerId: null,
      place: "hearth",
      text: "Meal time at the hearth.",
      heardBy: world.people.map((person) => person.id),
    });
  }
  if (world.tick % 120 === 0) {
    const next = nextWeather(world.weather, world);
    if (next !== world.weather) {
      world.weather = next;
      pushEvent(world, {
        kind: "weather",
        speakerId: null,
        audience: "town",
        listenerId: null,
        place: null,
        text: `The weather turns ${next}.`,
        heardBy: world.people.map((person) => person.id),
      });
      world.uncompiled += 1;
    }
  }
  if (world.tick % 180 === 0) cropGrowth(world.nodes, world, world.weather);
  // A storm sometimes fells a tree; the town shares the windfall.
  if (world.weather === "storm" && roll(world) < 0.01) stormPass(world);
}

function decay(world: World): void {
  for (const person of world.people.filter((item) => item.alive)) {
    person.hunger = clamp(person.hunger + (person.band === "toddler" ? 0.05 : 0.04), 0, 100);
    const sleeping = person.step?.kind === "sleep";
    if (sleeping) {
      person.energy = clamp(person.energy + 0.16, 0, 100);
    } else {
      let drain = 0.035;
      const wet = world.weather === "rain" || world.weather === "storm";
      const home = placeOf(person.place);
      const sheltered = home.shelter && dist(person, { x: home.x, y: home.y }) <= home.r;
      if (wet && !sheltered) drain += 0.02;
      if (world.phase === "night") drain += 0.01;
      person.energy = clamp(person.energy - drain, 0, 100);
    }
    person.belonging = clamp(person.belonging - (person.band === "toddler" ? 0.02 : 0.012), 0, 100);
    if (person.speech) {
      person.speech.ticks -= 1;
      if (person.speech.ticks <= 0) person.speech = null;
    }
  }
  for (const person of world.people) person.distress = isDistressed(person, world);
}

// ---------------------------------------------------------------- law

function stepMatches(step: ActiveStep, forced: StepOption, person: Person): boolean {
  if (forced.id === "go_home") {
    const home = centerOf(person.home);
    return step.kind === "walk" && Boolean(step.dest) && dist(step.dest ?? person, home) < 2.5;
  }
  if (forced.id === "cry") return step.kind === "express";
  if (forced.toId) {
    if (forced.kind === "care") return step.kind === "care" && step.toId === forced.toId;
    return step.kind === "walk" && step.toId === forced.toId;
  }
  return false;
}

function applyLaw(world: World, person: Person): void {
  const forced = forcedStep(person, world);
  if (!forced) return;
  if (person.step && stepMatches(person.step, forced, person)) return;
  if (forced.id === "cry") {
    say(world, person, "here", null, renderUtterance("need", "help", "fear"));
  }
  person.step = beginStep(world, person, forced);
  person.because =
    forced.id === "cry"
      ? "law: left without a guardian"
      : forced.id === "go_home"
        ? "law: curfew"
        : `law: ${forced.label.toLowerCase()}`;
  const last = [...world.log].reverse().find((event) => event.kind === "law" && event.speakerId === person.id);
  if (!last || world.tick - last.tick >= 30) {
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
}

// ---------------------------------------------------------------- movement

function walkSpeed(world: World, person: Person, leading: boolean): number {
  const base =
    person.band === "elder" ? 0.4 : person.band === "child" ? 0.42 : person.band === "youth" ? 0.5 : person.band === "toddler" ? 0.35 : 0.55;
  let speed = base * (0.6 + (0.4 * person.energy) / 100);
  if (terrainAt(TERRAIN, person.x, person.y) === "road") speed *= 1.25;
  if (world.weather === "rain") speed *= 0.85;
  if (world.weather === "storm") speed *= 0.6;
  if (carryCount(person.carry) >= carryCapacity(person.band)) speed *= 0.85;
  if (leading) speed *= 0.8;
  return speed;
}

function faceOf(dx: number, dy: number): Person["facing"] {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "front" : "back";
}

function moveAlong(world: World, person: Person, step: ActiveStep): void {
  if (!step.path) {
    if (!step.dest || dist(person, step.dest) <= 1.8) {
      person.step = step.then ?? null;
      if (person.step) validateStep(world, person);
      return;
    }
    step.path = findPath(TERRAIN, MASK, person, step.dest) ?? [{ x: step.dest.x, y: step.dest.y }];
  }
  const leading = Boolean(step.leadId);
  let budget = walkSpeed(world, person, leading);
  while (budget > 0 && step.path.length > 0) {
    const target = step.path[0];
    const dx = target.x - person.x;
    const dy = target.y - person.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= budget) {
      person.x = target.x;
      person.y = target.y;
      budget -= distance;
      step.path.shift();
    } else {
      person.x += (dx / distance) * budget;
      person.y += (dy / distance) * budget;
      person.facing = faceOf(dx, dy);
      budget = 0;
    }
  }
  person.place = regionAt(person) ?? person.place;
  if (leading) {
    const kid = world.people.find((item) => item.id === step.leadId);
    if (kid && kid.alive && dist(kid, person) <= 6) {
      kid.x = person.x + 1.2;
      kid.y = person.y + 0.7;
      kid.facing = person.facing;
      kid.step = null;
      kid.because = `with ${person.name}`;
      kid.place = regionAt(kid) ?? kid.place;
    }
  }
  if (step.path.length === 0) {
    person.step = step.then ?? null;
    if (person.step) validateStep(world, person);
  }
}

/** Drop a chained step whose target vanished (node spent, site finished). */
function validateStep(world: World, person: Person): void {
  let guard = 0;
  while (person.step && guard < 4) {
    const step = person.step;
    if (step.kind === "walk") return;
    if (step.nodeId) {
      const node = nodeById(world.nodes, step.nodeId);
      const useful =
        node &&
        (step.kind === "plant"
          ? node.stage === 0
          : step.kind === "harvest" && node.kind === "crop"
            ? node.stage >= node.maxStage
            : node.stage > 0);
      if (!useful) {
        person.step = step.then ?? null;
        guard += 1;
        continue;
      }
    }
    if (step.siteId && !world.sites.some((item) => item.id === step.siteId)) {
      person.step = step.then ?? null;
      guard += 1;
      continue;
    }
    return;
  }
}

// ---------------------------------------------------------------- progress

function progress(world: World, person: Person): void {
  const step = person.step;
  if (!step) return;
  if (step.kind === "walk") {
    moveAlong(world, person, step);
    return;
  }
  if (step.kind === "sleep") {
    // Sleep runs to dawn; only a fully rested napper stirs early.
    if (world.phase === "dawn" || world.phase === "day" || person.energy >= 99) finish(world, person, step);
    return;
  }
  if (step.remaining === undefined || step.remaining === null) step.remaining = WORK_TICKS[step.kind] ?? 12;
  step.remaining -= 1;
  if (step.remaining <= 0) finish(world, person, step);
}

function finish(world: World, person: Person, step: ActiveStep): void {
  const household = person.household;
  const storage = world.storages[household];
  let emptyWithdraw = false;

  switch (step.kind) {
    case "eat": {
      let source: "store" | "hand" | null = null;
      if (storage && spendMeal(storage)) source = "store";
      else if (spendMealFromCarry(person.carry)) source = "hand";
      if (source) {
        person.hunger = clamp(person.hunger - 45, 0, 100);
        if (source === "hand") {
          pushWorkEvent(world, person, `${person.name} eats from their own hands.`);
        } else {
          person.belonging = clamp(person.belonging + 4, 0, 100);
          pushWorkEvent(world, person, `${person.name} eats at home.`);
        }
      }
      break;
    }
    case "rest":
      person.energy = clamp(person.energy + 16, 0, 100);
      break;
    case "sleep":
      person.energy = clamp(person.energy + 6, 0, 100);
      break;
    case "chop":
    case "mine":
    case "harvest": {
      const node = step.nodeId ? nodeById(world.nodes, step.nodeId) : null;
      if (!node) break;
      const produced = yieldOf(node);
      if (!produced) break;
      const taken = addToCarry(person, produced.item, produced.qty);
      if (taken > 0) {
        deplete(node);
        const skill: Skill = node.kind === "crop" ? "farm" : node.kind === "berry" ? "forage" : "haul";
        gain(person, skill);
        person.energy = clamp(person.energy - (step.kind === "mine" ? 7 : step.kind === "chop" ? 6 : 3), 0, 100);
        if (person.band === "child") person.choresToday += 1;
        const doing =
          step.kind === "chop" ? "cuts wood" : step.kind === "mine" ? "breaks stone" : node.kind === "crop" ? "binds grain" : "picks berries";
        pushWorkEvent(world, person, `${person.name} ${doing} (${taken} ${produced.item}).`);
        world.uncompiled += 1;
      } else {
        pushWorkEvent(world, person, `${person.name} stops at the ${node.kind}, hands full.`);
      }
      break;
    }
    case "plant": {
      const node = step.nodeId ? nodeById(world.nodes, step.nodeId) : null;
      if (node && node.stage === 0 && (storage?.grain ?? 0) >= 1) {
        storage.grain -= 1;
        node.stage = 1;
        gain(person, "farm");
        person.energy = clamp(person.energy - 4, 0, 100);
        pushWorkEvent(world, person, `${person.name} sows a plot with seed grain.`);
        world.uncompiled += 1;
      }
      break;
    }
    case "store": {
      if (step.siteId) {
        const site = world.sites.find((item) => item.id === step.siteId);
        if (site) {
          const moved = deliverToSite(person, site);
          if (moved.length > 0) {
            pushEvent(world, {
              kind: "build",
              speakerId: person.id,
              audience: null,
              listenerId: null,
              place: regionAt(site) ?? person.place,
              text: `${person.name} leaves ${moved.map((entry) => `${entry.qty} ${entry.item}`).join(", ")} at the ${site.kind} site.`,
              heardBy: [],
            });
          }
        }
      } else {
        const moved = depositCarry(person, world.storages);
        if (moved.length > 0) {
          pushWorkEvent(world, person, `${person.name} stores ${moved.map((entry) => `${entry.qty} ${entry.item}`).join(", ")}.`);
        }
      }
      break;
    }
    case "withdraw": {
      const site = step.siteId ? world.sites.find((item) => item.id === step.siteId) : null;
      if (site) {
        let took = 0;
        for (const key of Object.keys(site.need) as Item[]) {
          const owed = Math.max(0, (site.need[key] ?? 0) - (site.have[key] ?? 0));
          if (owed <= 0) continue;
          took += withdraw(person, world.storages, key, owed);
        }
        // Hands already holding materials the site still owes count as a loaded trip.
        const handRelevant = (Object.keys(site.need) as Item[]).some(
          (key) => (site.need[key] ?? 0) > (site.have[key] ?? 0) && (person.carry[key] ?? 0) > 0,
        );
        if (took === 0 && !handRelevant) emptyWithdraw = true;
      } else if (person.owe) {
        // Fetching what a promised favor needs from the household store.
        const took = withdraw(person, world.storages, person.owe.item, person.owe.qty);
        if (took === 0 && (person.carry[person.owe.item] ?? 0) === 0) emptyWithdraw = true;
      }
      break;
    }
    case "give": {
      const owed = person.owe;
      const target = step.toId ? world.people.find((item) => item.id === step.toId) : null;
      if (owed && target?.alive && dist(person, target) <= 3.5) {
        const qty = Math.min(owed.qty, person.carry[owed.item] ?? 0);
        if (qty > 0) {
          const room = carryCapacity(target.band) - carryCount(target.carry);
          const toHands = Math.min(qty, Math.max(0, room));
          if (toHands > 0) target.carry[owed.item] = (target.carry[owed.item] ?? 0) + toHands;
          const toStore = qty - toHands;
          if (toStore > 0) world.storages[target.household][owed.item] += toStore;
          person.carry[owed.item] = (person.carry[owed.item] ?? 0) - qty;
          if ((person.carry[owed.item] ?? 0) <= 0) delete person.carry[owed.item];
          person.owe = null;
          touchBond(world, person.id, target.id, 10);
          feel(world, person.id, target.id, "love", 6);
          remember(world, target, `${person.name} brought ${qty} ${owed.item}.`, false, person.id, 1, 14);
          pushEvent(world, {
            kind: "work",
            speakerId: person.id,
            audience: null,
            listenerId: target.id,
            place: person.place,
            text: `${person.name} hands ${qty} ${owed.item} to ${target.name}, as promised.`,
            heardBy: whoHears(world, person, "here", null).map((other) => other.id),
          });
          world.uncompiled += 1;
        }
      }
      break;
    }
    case "build": {
      const site = step.siteId ? world.sites.find((item) => item.id === step.siteId) : null;
      if (site) {
        const raised = raiseStage(site);
        if (raised) {
          person.energy = clamp(person.energy - 8, 0, 100);
          gain(person, "haul");
          person.authority = clamp(person.authority + 1, 0, 100);
          pushEvent(world, {
            kind: "build",
            speakerId: person.id,
            audience: null,
            listenerId: null,
            place: regionAt(site) ?? person.place,
            text: `${person.name} raises the ${site.kind} — stage ${site.stage} of ${site.stages}.`,
            heardBy: [],
          });
          world.uncompiled += 1;
          if (siteComplete(site)) completeSite(world, person, site);
        }
      }
      break;
    }
    case "care": {
      const kid = step.toId ? world.people.find((item) => item.id === step.toId) : null;
      if (kid && kid.alive && dist(person, kid) <= 3) {
        kid.hunger = clamp(kid.hunger - 15, 0, 100);
        kid.belonging = clamp(kid.belonging + 12, 0, 100);
        person.belonging = clamp(person.belonging + 6, 0, 100);
      }
      break;
    }
    case "teach": {
      gain(person, "teach");
      for (const other of world.people) {
        if (!other.alive || other.id === person.id) continue;
        if (dist(other, person) <= 3.5 && (other.band === "child" || other.band === "youth")) {
          const pull = other.self.pull.find((item) => (SKILLS as readonly string[]).includes(item));
          if (pull) gain(other, pull as Skill);
        }
      }
      break;
    }
    case "learn": {
      const weakest = SKILLS.slice().sort((left, right) => person.skills[left] - person.skills[right])[0];
      if (weakest) gain(person, weakest);
      break;
    }
    case "play": {
      gain(person, "play");
      person.belonging = clamp(person.belonging + 8, 0, 100);
      person.energy = clamp(person.energy - 3, 0, 100);
      for (const other of world.people) {
        if (other.alive && dist(other, person) <= 3.5 && (other.band === "child" || other.band === "toddler")) {
          other.belonging = clamp(other.belonging + 4, 0, 100);
        }
      }
      break;
    }
    case "express":
    case "walk":
      break;
  }

  if (step.kind !== "walk" && step.kind !== "express") {
    remember(world, person, step.note.toUpperCase(), false, undefined, undefined, 2);
  }
  if (emptyWithdraw) {
    person.step = null;
    person.because = "nothing left to carry to the site";
    return;
  }
  person.step = step.then ?? null;
  if (person.step) validateStep(world, person);
}

function completeSite(world: World, person: Person, site: World["sites"][number]): void {
  world.sites = world.sites.filter((item) => item.id !== site.id);
  world.expansions.push({ id: site.id, ownerId: site.ownerId, kind: site.kind, label: site.label, x: site.x, y: site.y });
  person.authority = clamp(person.authority + 5, 0, 100);
  gatherFestival(world, site.label, person.name);
}

// ---------------------------------------------------------------- speech

export function say(world: World, speaker: Person, audience: Decision["audience"], listenerId: string | null, text: string): void {
  const heard = whoHears(world, speaker, audience, listenerId);
  const listener = world.people.find((person) => person.id === listenerId) ?? null;
  const address =
    audience === "private" && listener
      ? `${speaker.name} → ${listener.name}`
      : audience === "town"
        ? `${speaker.name} announces`
        : `${speaker.name} → here`;
  const line = `${address}: ${text}`;
  speaker.speech = { text, audience, listenerId, ticks: 8 };
  const saidAt = audience === "town" ? 8 : audience === "private" ? 6 : 4;
  remember(world, speaker, line, audience === "private", listenerId ?? undefined, undefined, saidAt);
  for (const other of heard) {
    remember(world, other, line, audience === "private", speaker.id, undefined, saidAt);
    const bump = audience === "private" ? 6 : audience === "town" ? 2 : 3;
    other.belonging = clamp(other.belonging + bump, 0, 100);
    if (audience === "private") {
      touchBond(world, speaker.id, other.id, 6);
      feel(world, speaker.id, other.id, "love", 5);
      if (speaker.spouse && speaker.spouse !== other.id) feel(world, speaker.spouse, other.id, "jealousy", 7);
    } else touchBond(world, speaker.id, other.id, audience === "town" ? 1 : 2);
    if (text.includes("DISLIKE") || text.includes("😠")) feel(world, speaker.id, other.id, "hate", 4);
  }
  speaker.belonging = clamp(speaker.belonging + (audience === "private" ? 6 : 4), 0, 100);
  advanceMatter(world, speaker, listenerId, audience);
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

function advanceMatter(world: World, speaker: Person, listenerId: string | null, audience: Decision["audience"]): void {
  const matter = speaker.matter;
  if (!matter || audience !== "private" || listenerId !== matter.withId) return;
  const other = world.people.find((person) => person.id === matter.withId && person.alive);
  if (!other) return;
  matter.step += 1;
  if (matter.kind === "court") feel(world, speaker.id, other.id, "love", 8);
  else if (matter.kind === "rival") {
    feel(world, speaker.id, other.id, "rivalry", 6);
    feel(world, speaker.id, other.id, "love", 2);
  } else if (matter.kind === "teach") feel(world, speaker.id, other.id, "love", 6);
  else feel(world, speaker.id, other.id, "love", 7);
  const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(speaker.id, other.id));
  const note =
    matter.kind === "court"
      ? `${speaker.name} is drawing closer to ${other.name}`
      : matter.kind === "rival"
        ? `${speaker.name} is keeping pace with ${other.name}`
        : matter.kind === "teach"
          ? `${speaker.name} is teaching ${other.name}`
          : `${speaker.name} is thawing toward ${other.name}`;
  if (bond) bond.note = note;
  if (matter.step < 3) return;
  speaker.settledWith.push(other.id);
  if (speaker.settledWith.length > 6) speaker.settledWith.shift();
  speaker.matter = chooseMatter(world, speaker);
  pushEvent(world, {
    kind: "work",
    speakerId: speaker.id,
    audience: "town",
    listenerId: other.id,
    place: speaker.place,
    text: `${speaker.name} and ${other.name} have a steadier tie.`,
    heardBy: world.people.filter((person) => person.alive).map((person) => person.id),
  });
}

export function ensureMatters(world: World): void {
  for (const person of world.people) {
    if (!person.matter) person.matter = chooseMatter(world, person);
  }
}

// ---------------------------------------------------------------- dialogue acts

/** Favors unkept past two in-world days turn into remembered slights. */
const STALE_FAVOR_TICKS = 2880;

/** Luna's words land here; code delivers them and makes them count. */
export function queueDialogue(
  world: World,
  fromId: string,
  toId: string | "town",
  act: DialogueAct,
  line: string,
): void {
  if (world.dialogue.length >= 12) world.dialogue.shift();
  world.dialogue.push({ fromId, toId, act, line, expires: world.tick + 45 });
}

function acceptRequest(world: World, receiver: Person, from: Person, item: Item, qty: number): boolean {
  if (receiver.band === "toddler" || receiver.band === "child") return false;
  if (receiver.owe) return false;
  const bond = world.bonds.find((entry) => bondKey(entry.a, entry.b) === bondKey(receiver.id, from.id));
  if ((bond?.score ?? 0) < 45) return false;
  const storage = world.storages[receiver.household];
  if ((storage?.[item] ?? 0) + (receiver.carry[item] ?? 0) < qty) return false;
  receiver.owe = { toId: from.id, item, qty, at: world.tick };
  receiver.task = { label: `bring ${qty} ${item} to ${from.name}`.slice(0, 48), chosen: [], startedTick: world.tick };
  return true;
}

function actEffect(world: World, entry: PendingDialogue, speaker: Person, listener: Person): void {
  const act = entry.act;
  if (act.kind === "request") {
    if (acceptRequest(world, listener, speaker, act.item, act.qty)) {
      remember(world, listener, `${speaker.name} asked for ${act.qty} ${act.item}.`, true, speaker.id, undefined, 12);
    }
    return;
  }
  if (act.kind === "give") {
    const held = speaker.carry[act.item] ?? 0;
    if (held >= 1 && dist(speaker, listener) <= 3.5) {
      // Hands already full of the promised thing: pass it straight over.
      speaker.owe = null;
      speaker.carry[act.item] = held;
      const qty = Math.min(act.qty, held);
      const room = carryCapacity(listener.band) - carryCount(listener.carry);
      const toHands = Math.min(qty, Math.max(0, room));
      if (toHands > 0) listener.carry[act.item] = (listener.carry[act.item] ?? 0) + toHands;
      const toStore = qty - toHands;
      if (toStore > 0) world.storages[listener.household][act.item] += toStore;
      speaker.carry[act.item] = held - qty;
      if ((speaker.carry[act.item] ?? 0) <= 0) delete speaker.carry[act.item];
      touchBond(world, speaker.id, listener.id, 8);
      remember(world, listener, `${speaker.name} handed over ${qty} ${act.item} as promised.`, false, speaker.id, 1, 12);
    } else if (!speaker.owe) {
      // Not in hand: the speaker now owes the delivery, same as a request.
      speaker.owe = { toId: listener.id, item: act.item, qty: act.qty, at: world.tick };
      speaker.task = { label: `bring ${act.qty} ${act.item} to ${listener.name}`.slice(0, 48), chosen: [], startedTick: world.tick };
    }
    return;
  }
  if (act.kind === "invite") {
    listener.invite = { place: act.place, untilTick: world.tick + 90 };
    remember(world, listener, `${speaker.name} invited them to ${placeOf(act.place).name}.`, false, speaker.id, 1, 6);
    return;
  }
  if (act.kind === "warn") {
    touchBond(world, speaker.id, listener.id, 2);
    remember(world, listener, `${speaker.name} gave a warning.`, true, speaker.id, undefined, 8);
    return;
  }
  if (act.kind === "comfort") {
    listener.belonging = clamp(listener.belonging + 6, 0, 100);
    touchBond(world, speaker.id, listener.id, 5);
    feel(world, speaker.id, listener.id, "love", 3);
    if (listener.ill) {
      listener.ill = null;
      townCeremony(world, `${listener.name}, comforted by ${speaker.name}, is well again.`, "life", 2);
    }
    remember(world, listener, `${speaker.name} sat with them a while.`, true, speaker.id, 1, 10);
    return;
  }
  if (act.kind === "thank") {
    touchBond(world, speaker.id, listener.id, 4);
    feel(world, speaker.id, listener.id, "love", 2);
    remember(world, listener, `${speaker.name} thanked them.`, true, speaker.id, 1, 6);
    return;
  }
  if (act.kind === "tease") {
    touchBond(world, speaker.id, listener.id, -3);
    feel(world, speaker.id, listener.id, "rivalry", 2);
    remember(world, listener, `${speaker.name} teased them.`, true, speaker.id, -1, 8);
    return;
  }
}

/**
 * Deliver queued Luna lines the moment speaker and listener share air, drop
 * them when they expire, and clear favors whose target is gone. Law holds:
 * a town-wide announcement only stays town-wide from the square, from an
 * adult or elder — otherwise it degrades to whoever is standing there.
 */
export function deliverDialogue(world: World): void {
  if (world.dialogue.length > 0) {
    const remaining: PendingDialogue[] = [];
    for (const entry of world.dialogue) {
      const speaker = world.people.find((person) => person.id === entry.fromId && person.alive);
      if (!speaker || world.tick > entry.expires) continue;
      if (entry.toId === "town") {
        const square = placeOf("square");
        const lawful =
          (speaker.band === "adult" || speaker.band === "elder") &&
          dist(speaker, { x: square.x, y: square.y }) <= square.r;
        if (!lawful && othersHere(speaker, world).length === 0) {
          remaining.push(entry); // wait for some audience at all
          continue;
        }
        say(world, speaker, lawful ? "town" : "here", null, entry.line);
      } else {
        const listener = world.people.find((person) => person.id === entry.toId && person.alive);
        if (!listener) continue;
        if (dist(speaker, listener) > 3.5) {
          remaining.push(entry);
          continue;
        }
        say(world, speaker, "private", listener.id, entry.line);
        actEffect(world, entry, speaker, listener);
      }
    }
    world.dialogue = remaining;
  }
  // A favor whose recipient died or left is a weight with no purpose; one that
  // sat past two days is a broken promise, and both sides remember it.
  for (const person of world.people) {
    const owed = person.owe;
    if (!owed) continue;
    const creditor = world.people.find((other) => other.id === owed.toId && other.alive);
    if (!creditor) {
      person.owe = null;
      continue;
    }
    if (typeof owed.at === "number" && world.tick - owed.at > STALE_FAVOR_TICKS) {
      storeMemory(world, creditor, {
        clock: clockLabel(world.hour, world.minute),
        text: `${person.name} never brought the promised ${owed.item}.`,
        private: false,
        about: person.id,
        polarity: -1,
        salience: 16,
        at: world.tick,
      });
      storeMemory(world, person, {
        clock: clockLabel(world.hour, world.minute),
        text: `The ${owed.item} owed to ${creditor.name} never got carried.`,
        private: true,
        about: creditor.id,
        polarity: -1,
        salience: 12,
        at: world.tick,
      });
      feel(world, creditor.id, person.id, "rivalry", 3);
      pushEvent(world, {
        kind: "law",
        speakerId: person.id,
        audience: null,
        listenerId: creditor.id,
        place: person.place,
        text: `${person.name}'s promise of ${owed.item} to ${creditor.name} faded unkept.`,
        heardBy: [],
      });
      person.owe = null;
    }
  }
}

function chooseMatter(world: World, person: Person): Matter | null {
  if (!person.alive || person.band === "toddler" || person.band === "child") return null;
  const blocked = new Set(person.settledWith);
  const otherById = (id: string | null): Person | null => {
    if (!id || id === person.id || blocked.has(id)) return null;
    const other = world.people.find((candidate) => candidate.id === id && candidate.alive && candidate.band !== "toddler");
    return other ?? null;
  };
  const spouse = otherById(person.spouse);
  if (spouse) {
    const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(person.id, spouse.id));
    if ((bond?.love ?? 0) < 90) return { withId: spouse.id, kind: "court", step: 0 };
  }
  const pupil = person.dependents.map((id) => otherById(id)).find((other) => other && (other.band === "child" || other.band === "youth"));
  if (pupil && (person.band === "adult" || person.band === "elder")) return { withId: pupil.id, kind: "teach", step: 0 };
  const rival = world.bonds
    .filter((bond) => (bond.a === person.id || bond.b === person.id) && bond.rivalry >= 12)
    .map((bond) => otherById(bond.a === person.id ? bond.b : bond.a))
    .find((other): other is Person => Boolean(other));
  if (rival && person.band !== "elder") return { withId: rival.id, kind: "rival", step: 0 };
  const coldPool = world.people
    .filter((other) => other.alive && other.id !== person.id && other.band !== "toddler" && other.band !== "child" && !blocked.has(other.id))
    .map((other) => {
      const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(person.id, other.id));
      const salt = [...`${person.id}${other.id}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return { other, love: bond?.love ?? 8, salt };
    })
    .sort((left, right) => left.love - right.love || left.salt - right.salt);
  const coldestLove = coldPool[0]?.love;
  const coldest = coldPool.filter((item) => item.love === coldestLove);
  const cold = coldest[[...person.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % Math.max(1, coldest.length)];
  if (!cold) return null;
  return { withId: cold.other.id, kind: "rift", step: 0 };
}

function publicMatter(world: World, person: Person): PublicPerson["matter"] {
  if (!person.matter) return null;
  const other = world.people.find((candidate) => candidate.id === person.matter?.withId);
  if (!other) return null;
  return { withName: other.name, kind: person.matter.kind, step: person.matter.step };
}

function remember(
  world: World,
  person: Person,
  text: string,
  isPrivate: boolean,
  about?: string,
  polarity?: number,
  salience = 4,
): void {
  storeMemory(world, person, {
    clock: clockLabel(world.hour, world.minute),
    text,
    private: isPrivate,
    about,
    polarity,
    salience,
    at: world.tick,
  });
}

function feel(world: World, a: string, b: string, key: "love" | "jealousy" | "hate" | "rivalry", delta: number): void {
  let bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(a, b));
  if (!bond) {
    bond = { a, b, score: 30, note: "acquainted in town", love: 10, jealousy: 0, hate: 0, rivalry: 0 };
    world.bonds.push(bond);
  }
  bond[key] = clamp(bond[key] + delta, 0, 100);
}

function touchBond(world: World, a: string, b: string, delta: number): void {
  let bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(a, b));
  if (!bond) {
    bond = { a, b, score: 35, note: "acquainted in town", love: 10, jealousy: 0, hate: 0, rivalry: 0 };
    world.bonds.push(bond);
  }
  bond.score = clamp(bond.score + delta, 0, 100);
}

// ---------------------------------------------------------------- life

function ageAndLife(world: World): void {
  const birthday = world.day % 30 === 0;
  for (const person of world.people) {
    if (!person.alive) continue;
    if (birthday) {
      person.age += 1;
      person.band = bandFor(person.age);
    }
    const starved = person.hunger >= 100 && person.energy < 8 && person.age > 60;
    const old = person.age >= 92 || (person.age >= 78 && birthday && person.energy < 25);
    if (starved || old) {
      person.alive = false;
      person.step = null;
      pushEvent(world, {
        kind: "life",
        speakerId: person.id,
        audience: "town",
        listenerId: null,
        place: person.place,
        text: `${person.name} has died, age ${person.age}.`,
        heardBy: world.people.filter((item) => item.alive).map((item) => item.id),
      });
      world.uncompiled += 1;
      townCeremony(world, `The town keeps a vigil for ${person.name}, gone at ${person.age}.`, "life", -4);
    }
  }
  tryBirth(world);
}

function tryBirth(world: World): void {
  if (world.people.filter((person) => person.alive).length >= 24) return;
  if (world.day % 12 !== 0) return;
  const mother = world.people.find((person) => {
    if (!person.alive || !person.spouse || person.gender !== "female" || person.band !== "adult") return false;
    const father = world.people.find((other) => other.id === person.spouse);
    if (!father?.alive || dist(father, person) > 2.5) return false;
    const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(person.id, father.id));
    return (bond?.love ?? 0) >= 55 && foodInStorage(world.storages[person.household]) >= 6;
  });
  if (!mother || !mother.spouse) return;
  const father = world.people.find((person) => person.id === mother.spouse);
  if (!father) return;
  const syllables = ["eth", "ine", "os", "elle", "ar", "ith", "ael"];
  const stem = syllables[world.day % syllables.length] ?? "eth";
  const id = `child${world.day}${world.people.length}`;
  const girl = world.day % 2 === 0;
  const child: Person = {
    ...mother,
    id,
    name: `Jev${stem}`,
    age: 0,
    gender: girl ? "female" : "male",
    band: "toddler",
    spouse: null,
    guardians: [mother.id, father.id],
    dependents: [],
    place: regionAt(mother) ?? mother.place,
    x: mother.x + 1,
    y: mother.y + 1,
    facing: "front",
    hunger: 20,
    energy: 70,
    belonging: 70,
    distress: false,
    choresToday: 0,
    projectProgress: 0,
    authority: 0,
    bricks: 0,
    alive: true,
    matter: null,
    settledWith: [],
    step: null,
    task: null,
    carry: {},
    speech: null,
    memory: [],
    mood: "new",
    innerNote: "just born",
    because: "born",
    skills: { farm: 0, cook: 0, mend: 0, forage: 0, haul: 0, heal: 0, teach: 0, play: 5 },
  };
  child.self = {
    ...mother.self,
    temper: "new and loud",
    want: "a lap",
    fear: "being alone",
    habit: "cries",
    pull: ["play"],
    custom: "learn",
    ambition: { ...mother.self.ambition, career: "none yet", plan: "stay alive", project: "garden", passion: "being held" },
  };
  mother.dependents.push(id);
  father.dependents.push(id);
  world.people.push(child);
  world.bonds.push({ a: mother.id, b: id, score: 90, note: "mother and newborn", love: 90, jealousy: 0, hate: 0, rivalry: 0 });
  world.bonds.push({ a: father.id, b: id, score: 80, note: "father and newborn", love: 80, jealousy: 0, hate: 0, rivalry: 0 });
  const storage = world.storages[mother.household];
  if (storage) {
    let left = 4;
    const grain = Math.min(left, storage.grain ?? 0);
    storage.grain = (storage.grain ?? 0) - grain;
    left -= grain;
    const berries = Math.min(left, storage.berries ?? 0);
    storage.berries = (storage.berries ?? 0) - berries;
  }
  pushEvent(world, {
    kind: "life",
    speakerId: id,
    audience: "town",
    listenerId: null,
    place: child.place,
    text: `${child.name} is born to ${mother.name} and ${father.name}.`,
    heardBy: world.people.filter((person) => person.alive).map((person) => person.id),
  });
  world.pendingNames.push(id);
  world.uncompiled += 1;
}

function gain(person: Person, skill: Skill): void {
  person.skills[skill] = clamp(person.skills[skill] + 1, 0, 100);
}

function pushWorkEvent(world: World, person: Person, text: string): void {
  pushEvent(world, {
    kind: "work",
    speakerId: person.id,
    audience: null,
    listenerId: null,
    place: person.place,
    text,
    heardBy: [],
  });
}

// ---------------------------------------------------------------- ceremonies

/** A moment the whole town witnesses — a rite, a festival, a vigil, a windfall. */
export function townCeremony(world: World, text: string, kind: CityEvent["kind"] = "life", warm = 4): void {
  pushEvent(world, {
    kind,
    speakerId: null,
    audience: "town",
    listenerId: null,
    place: "square",
    text,
    heardBy: world.people.filter((item) => item.alive).map((item) => item.id),
  });
  world.uncompiled += 1;
  if (warm !== 0) {
    for (const person of world.people) {
      if (person.alive) person.belonging = clamp(person.belonging + warm, 0, 100);
    }
  }
}

/** A storm fells a tree; the windfall is shared into every household store. */
export function stormPass(world: World): void {
  const trees = world.nodes.filter((node) => node.kind === "tree" && node.stage > 0);
  const tree = trees.length > 0 ? (trees[Math.floor(roll(world) * trees.length)] ?? null) : null;
  if (!tree) return;
  tree.stage = 0;
  tree.growAt = null;
  for (const key of Object.keys(world.storages)) world.storages[key].wood += 2;
  townCeremony(world, "The storm fells a tree; the town gathers 2 wood from the windfall.", "weather", 0);
}

/**
 * Dawn health: illness passes with comfort or two days of rest, and most
 * dawns nobody new falls ill. Nobody new sickens while someone still is.
 */
export function dawnHealth(world: World): void {
  for (const person of world.people) {
    if (!person.alive || !person.ill) continue;
    if (world.tick - person.ill.since > 2880) {
      person.ill = null;
      townCeremony(world, `${person.name} is well again after days of illness.`, "life", 2);
    }
  }
  if (world.people.some((person) => person.alive && person.ill)) return;
  if (roll(world) >= 0.18) return;
  const candidates = world.people.filter((person) => person.alive && (person.band === "adult" || person.band === "elder"));
  const sick = candidates.length > 0 ? (candidates[Math.floor(roll(world) * candidates.length)] ?? null) : null;
  if (!sick) return;
  sick.ill = { since: world.tick };
  townCeremony(world, `${sick.name} has fallen ill and keeps to their bed.`, "life", 0);
}

/** A finished build pulls every able hand to the square to celebrate. */
export function gatherFestival(world: World, label: string, builder: string | null = null): void {
  for (const person of world.people) {
    if (person.alive && capableMember(person)) person.invite = { place: "square", untilTick: world.tick + 120 };
  }
  const credit = builder ? ` — ${builder} raised it stage by stage` : "";
  townCeremony(world, `${label} stands finished${credit}, and the town gathers at the square to celebrate.`, "build", 6);
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

// ---------------------------------------------------------------- view

export function doingOf(person: Person, thinking: boolean): string {
  if (thinking && !person.step) return "thinking";
  if (!person.step) return "idle";
  return person.step.note;
}

function feelingOf(world: World, person: Person): PublicPerson["feeling"] {
  if (!person.alive) return "content";
  if (person.distress) return "afraid";
  const mine = world.bonds.filter((bond) => bond.a === person.id || bond.b === person.id);
  if (mine.some((bond) => bond.hate > 55)) return "bitter";
  if (mine.some((bond) => bond.jealousy > 50)) return "jealous";
  if (mine.some((bond) => bond.rivalry > 62)) return "rival";
  if (person.hunger > 62) return "hungry";
  if (person.energy < 32) return "tired";
  if (person.belonging < 34) return "lonely";
  if (person.step?.kind === "play") return "playing";
  return "content";
}

function ledBy(world: World, person: Person): string | null {
  if (person.band !== "toddler" || person.step) return null;
  const leader = world.people.find((other) => other.alive && other.step?.leadId === person.id);
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
    moving: person.step?.kind === "walk" && (person.step.path?.length ?? 0) > 0,
    feeling: feelingOf(world, person),
    authority: person.authority,
    bricks: person.bricks,
    alive: person.alive,
    matter: publicMatter(world, person),
    task: person.task ?? null,
    hunger: person.hunger,
    energy: person.energy,
    belonging: person.belonging,
    distress: person.distress,
    mood: person.mood,
    innerNote: person.innerNote,
    because: person.because,
    doing: doingOf(person, thinking.has(person.id)),
    thinking: thinking.has(person.id) && person.step === null,
    carry: person.carry,
    ledBy: ledBy(world, person),
    self: person.self,
    skills: person.skills,
    speech: person.speech,
    memory: person.memory,
    beliefs: person.beliefs ?? [],
  }));
  return {
    tick: world.tick,
    hour: world.hour,
    minute: world.minute,
    clock: clockLabel(world.hour, world.minute),
    phase: world.phase,
    weather: world.weather,
    day: world.day,
    storages: world.storages,
    people,
    bonds: world.bonds,
    nodes: world.nodes,
    sites: world.sites,
    animals: world.animals,
    beast: world.beast,
    log: world.log,
    chronicle: world.chronicle,
    chronicleAt: world.chronicleAt,
    story: world.story,
    expansions: world.expansions,
    visitors: world.visitors.map((visitor) => ({
      id: visitor.id,
      name: visitor.name,
      place: visitor.place,
      x: visitor.x,
      y: visitor.y,
      facing: visitor.facing,
      speech: visitor.speech,
      note: visitor.note,
    })),
    visitorLog: world.visitorLog.slice(-12),
    soul: world.soul,
    luna: world.luna,
    brain: world.brain,
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
  const stamped = world.chronicleAt ? `_Compacted ${world.chronicleAt}._` : "_Raw log. Compaction runs when the story model is configured._";
  return `# JEV City chronicle\n\n${stamped}\n\n## Town memory\n\n${memory}\n\n## People\n\n${people}\n\n## Bonds\n\n${bonds}\n\n## Recent\n\n${recent || "- The day has just started."}\n`;
}
