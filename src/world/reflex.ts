import { allowedIntentIds, allowedToneIds, allowedTopicIds } from "./lexicon.js";
import { placeOf } from "./map.js";
import { customBonus, legalActions, skillFor } from "./rules.js";
import { othersHere } from "./speech.js";
import type { ActionKind, ActionOption, Decision, Person, World } from "./types.js";
import { bondKey } from "./types.js";

const OUTDOOR = new Set<ActionKind>(["farm", "forage", "haul", "watch"]);

function hashName(id: string): number {
  return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function scoreAction(person: Person, world: World, action: ActionOption): number {
  let score = 2;
  const skill = skillFor(action.kind);
  if (skill) score += person.skills[skill] * 0.55;
  score += customBonus(person, action.kind);
  if (person.self.pull.includes(action.kind)) score += 24;
  const projectActs: Record<string, string[]> = {
    garden: ["farm", "cook"],
    orchard: ["forage"],
    stall: ["mend", "haul"],
    house: ["build", "haul"],
    shrine: ["teach", "learn"],
    watch: ["watch"],
  };
  if ((projectActs[person.self.ambition.project] ?? []).includes(action.kind)) score += 18;
  if (action.kind === "eat" && person.hunger > 72) score += 70 + person.hunger;
  if (action.kind === "eat" && person.hunger < 60) score -= 30;
  if (action.kind === "eat" && (world.hour === 8 || world.hour === 13 || world.hour === 19)) score += 28;
  if (action.kind === "sleep" && (world.phase === "night" || person.energy < 28)) score += 74;
  if (action.kind === "rest" && person.energy < 40) score += 36;
  if (action.kind === "speak" && person.belonging < 42) score += 26;
  if (action.kind === "play" && (person.band === "child" || person.band === "toddler") && person.hunger < 65) score += 30;
  if (action.kind === "care") score += 40;
  if (world.weather === "rain" && OUTDOOR.has(action.kind)) score -= 20;
  if (action.kind === "go" && action.place) {
    const shelter = placeOf(action.place).shelter;
    if (person.hunger > 60 && (action.place === person.home || action.place === "hearth")) score += 48;
    if ((world.phase === "night" || world.phase === "dusk") && action.place === person.home) score += 42;
    if (world.weather === "rain" && shelter) score += 16;
    if (action.place === "field" && person.self.pull.includes("farm")) score += 18;
    if (action.place === "grove" && person.self.pull.includes("forage")) score += 18;
    if (action.place === "hearth" && person.self.pull.includes("cook")) score += 18;
    if (action.place === "market" && person.self.pull.includes("mend")) score += 18;
    if (action.place === "porch" && person.self.pull.includes("teach")) score += 18;
    if (action.escort) score += 30;
    if (action.place !== person.place) score += 8 + ((world.tick + hashName(person.id) + action.place.length) % 5) * 4;
  }
  if (action.kind === "stay") score += 4;
  return score;
}

function pickListener(person: Person, world: World): string | null {
  const others = othersHere(person, world);
  if (others.length === 0) return null;
  const spouse = others.find((other) => other.id === person.spouse);
  if (spouse && person.belonging < 70) return spouse.id;
  const child = others.find((other) => person.dependents.includes(other.id));
  if (child) return child.id;
  const guardian = others.find((other) => person.guardians.includes(other.id));
  if (guardian) return guardian.id;
  const ranked = others
    .map((other) => {
      const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(person.id, other.id));
      return { id: other.id, score: bond?.score ?? 30 };
    })
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.id ?? null;
}

function utteranceFor(person: Person, world: World, action: ActionOption): Pick<Decision, "speak" | "audience" | "listenerId" | "intentWord" | "topic" | "tone"> {
  const intents = allowedIntentIds(person.band);
  const topics = allowedTopicIds(person.band);
  const tones = allowedToneIds(person.band);
  const roll = (world.tick + hashName(person.id)) % 8;
  let speak = action.kind === "speak" || person.distress || person.hunger > 68 || person.belonging < 36 || roll === 0;
  let intentWord = "tell";
  let topic = "work";
  let tone = "soft";

  if (person.distress || action.id === "cry") {
    speak = true;
    intentWord = "need";
    topic = "help";
    tone = "fear";
  } else if (person.hunger > 72) {
    intentWord = "need";
    topic = "food";
    tone = "hunger";
  } else if (person.energy < 30) {
    intentWord = "need";
    topic = "rest";
    tone = "tired";
  } else if (world.weather === "rain") {
    intentWord = "tell";
    topic = "rain";
    tone = "rain";
  } else if (action.kind === "play") {
    intentWord = "play";
    topic = "play";
    tone = "joy";
  } else if (action.kind === "farm" || action.kind === "forage") {
    intentWord = "work";
    topic = "crop";
    tone = "soft";
  } else if (action.kind === "cook" || action.kind === "eat") {
    intentWord = "eat";
    topic = "food";
    tone = "please";
  } else if (action.kind === "teach" || action.kind === "learn") {
    intentWord = "look";
    topic = "work";
    tone = "ask";
  } else if (action.kind === "care") {
    intentWord = "come";
    topic = "home";
    tone = "love";
  } else if (world.phase === "night") {
    intentWord = "come";
    topic = "home";
    tone = "guard";
  }

  if (!intents.includes(intentWord)) intentWord = intents[0] ?? "need";
  if (!topics.includes(topic)) topic = topics[0] ?? "help";
  if (!tones.includes(tone)) tone = tones[0] ?? "soft";

  const listenerId = pickListener(person, world);
  let audience: Decision["audience"] = "here";
  if (listenerId && (person.spouse === listenerId || person.dependents.includes(listenerId) || person.guardians.includes(listenerId) || person.belonging < 40)) {
    audience = "private";
  }
  if (
    person.place === "square" &&
    (person.band === "adult" || person.band === "elder") &&
    (world.weather === "rain" || world.phase === "dusk") &&
    roll === 0
  ) {
    audience = "town";
    intentWord = world.weather === "rain" ? "danger" : "tell";
    if (!intents.includes(intentWord)) intentWord = "tell";
  }

  if (action.kind !== "speak" && !person.distress && action.id !== "cry" && roll !== 0 && person.hunger <= 68 && person.belonging >= 36) {
    speak = false;
  }

  return { speak, audience, listenerId, intentWord, topic, tone };
}

export function reflexDecide(world: World, personId: string): Decision {
  const person = world.people.find((item) => item.id === personId);
  if (!person) {
    return {
      personId,
      actionId: "stay",
      speak: false,
      audience: "here",
      listenerId: null,
      intentWord: "stay",
      topic: "home",
      tone: "soft",
      because: "missing person",
      source: "reflex",
      confidence: null,
    };
  }
  const actions = legalActions(person, world);
  const best = actions.slice().sort((left, right) => scoreAction(person, world, right) - scoreAction(person, world, left))[0];
  const chosen = best ?? actions[0];
  if (!chosen) {
    throw new Error(`No legal act for ${person.name}`);
  }
  const speech = utteranceFor(person, world, chosen);
  const reason = `${person.self.temper.split(",")[0]}; ${chosen.label.toLowerCase()}`;
  return {
    personId: person.id,
    actionId: chosen.id,
    because: reason,
    source: "reflex",
    confidence: null,
    ...speech,
  };
}
