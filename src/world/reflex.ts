import { siteNeeds } from "./construction.js";
import { allowedIntentIds, allowedToneIds, allowedTopicIds } from "./lexicon.js";
import { centerOf, placeOf } from "./map.js";
import { nodeById } from "./nodes.js";
import { legalSteps } from "./rules.js";
import { othersHere } from "./speech.js";
import type { Decision, Person, Skill, StepOption, World } from "./types.js";
import { bondKey, carryCapacity, carryCount, dist } from "./types.js";

/**
 * Provisional reflex: the brainstem that keeps the town alive until the Jev
 * spine (Stage 2) takes over step choice. It only ever ranks the legal step
 * list — it cannot invent steps, and it never calls a model.
 */

const OUTDOOR = new Set<StepOption["kind"]>(["chop", "mine", "harvest", "plant", "build"]);

function hashName(id: string): number {
  return [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function skillForStep(world: World, option: StepOption): Skill | null {
  if (option.kind === "chop" || option.kind === "mine" || option.kind === "build") return "haul";
  if (option.kind === "harvest") {
    const node = option.nodeId ? nodeById(world.nodes, option.nodeId) : null;
    return node?.kind === "crop" ? "farm" : "forage";
  }
  if (option.kind === "plant") return "farm";
  if (option.kind === "teach") return "teach";
  if (option.kind === "play") return "play";
  return null;
}

/** Pulls map to the old act names so the seeds' `self.pull` still steer. */
function pullLike(world: World, option: StepOption): string | null {
  if (option.kind === "chop" || option.kind === "mine") return "haul";
  if (option.kind === "build") return "haul";
  if (option.kind === "harvest") {
    const node = option.nodeId ? nodeById(world.nodes, option.nodeId) : null;
    return node?.kind === "crop" ? "farm" : "forage";
  }
  if (option.kind === "plant") return "farm";
  if (option.kind === "teach") return "teach";
  if (option.kind === "learn") return "learn";
  if (option.kind === "play" || option.kind === "care") return "care";
  return null;
}

function projectSteps(person: Person, world: World, option: StepOption): boolean {
  const project = person.self.ambition.project;
  const kind = option.kind;
  if (kind === "chop" || kind === "mine" || kind === "build") {
    if (project === "house" || project === "watch" || project === "stall" || project === "shrine") return true;
    return false;
  }
  if (kind === "plant") return project === "garden";
  if (kind === "harvest") {
    const node = option.nodeId ? nodeById(world.nodes, option.nodeId) : null;
    if (node?.kind === "crop") return project === "garden";
    return project === "orchard";
  }
  if (kind === "store" && option.siteId) return project === "house" || project === "stall" || project === "shrine" || project === "watch";
  return false;
}

function optionTarget(person: Person, world: World, option: StepOption): { x: number; y: number } | null {
  if (option.nodeId) return nodeById(world.nodes, option.nodeId);
  if (option.siteId) return world.sites.find((site) => site.id === option.siteId) ?? null;
  if (option.toId) return world.people.find((other) => other.id === option.toId) ?? null;
  if (option.place) return centerOf(option.place);
  return null;
}

function scoreStep(person: Person, world: World, option: StepOption): number {
  let score = 2;
  const skill = skillForStep(world, option);
  if (skill) score += person.skills[skill] * 0.5;
  const pull = pullLike(world, option);
  if (pull && person.self.pull.includes(pull as never)) score += 22;
  if (projectSteps(person, world, option)) score += 16;

  const target = optionTarget(person, world, option);
  // A owed favor is exempt from the distance tax: walking the delivery is the
  // promise itself, so a far recipient does not cool the word given.
  if (target && option.kind !== "walk" && option.kind !== "give") score -= dist(person, target) * 0.55;

  if (option.kind === "eat") {
    if (person.hunger > 55) score += 60 + (person.hunger - 55);
    if (person.hunger < 35) score -= 35;
    if (person.hunger > 45 && [8, 13, 19].includes(world.hour)) score += 18;
  }
  if (option.kind === "sleep") {
    if (world.phase === "night") score += 85;
    if (person.energy < 25) score += 75;
    else if (person.energy < 45) score += 34;
    if (world.phase === "day" && person.energy > 55) score -= 25;
  }
  if (option.kind === "rest") score += person.energy < 35 ? 42 : -10;
  if (option.kind === "express") score += person.belonging < 25 ? 26 : 4;
  if (option.kind === "play") {
    if ((person.band === "toddler" || person.band === "child") && person.hunger < 65) score += 34;
    else score -= 12;
  }
  if (option.kind === "care") score += 48;
  if (option.kind === "teach" && (person.band === "elder" || person.skills.teach > 60)) score += 24;
  if (option.kind === "learn" && (person.band === "youth" || person.band === "child")) score += 20;

  if (option.kind === "store") {
    const fullness = carryCount(person.carry) / Math.max(1, carryCapacity(person.band));
    score += 50 + fullness * 32;
    if (option.siteId) {
      const site = world.sites.find((item) => item.id === option.siteId);
      if (site) score += siteNeeds(site) > 0 ? 26 : 6;
    }
  }
  // The brainstem keeps promises: a owed favor outranks almost everything.
  if (option.kind === "give") score += 70;
  // An invitation from conversation pulls the walk for a while.
  if (option.kind === "walk" && option.place && person.invite && person.invite.untilTick > world.tick) {
    if (person.invite.place === option.place) score += 20;
  }
  // Full hands end gathering: nothing more can be picked up, so stop offering it.
  if (
    OUTDOOR.has(option.kind) &&
    option.kind !== "build" &&
    carryCount(person.carry) >= carryCapacity(person.band)
  ) {
    score -= 60;
  }
  if (option.kind === "build") score += 34;
  if (option.kind === "chop" && (world.storages[person.household]?.wood ?? 0) < 4) score += 12;
  if (option.kind === "mine" && (world.storages[person.household]?.stone ?? 0) < 3) score += 12;
  if ((option.kind === "harvest" || option.kind === "plant") && foodOf(world, person) < 8) score += 24;
  if ((option.kind === "harvest" || option.kind === "plant") && foodOf(world, person) < 2) score += 14;
  if ((option.kind === "harvest" || option.kind === "plant") && person.hunger > 55) score += 30;
  // Sated larders: gathering more food than the household can eat soon wastes the day.
  if (option.kind === "harvest" && foodOf(world, person) > 16) {
    const node = option.nodeId ? nodeById(world.nodes, option.nodeId) : null;
    if (node?.kind === "berry") score -= 34;
    if (node?.kind === "crop" && foodOf(world, person) > 40) score -= 24;
  }
  // A very hungry person drops everything that is not eating or food work —
  // but a promised favor keeps competing: food work still outranks it, and it
  // is kept the moment the stomach allows.
  if (person.hunger > 70 && !["eat", "harvest", "plant", "store", "walk", "express", "give"].includes(option.kind)) score -= 45;

  if (world.weather === "rain" && OUTDOOR.has(option.kind)) score -= 18;
  if (world.weather === "storm" && OUTDOOR.has(option.kind)) score -= 45;

  if (option.kind === "walk" && option.place) {
    score += 6 + ((world.tick + hashName(person.id) + option.place.length) % 5) * 3;
    if ((world.phase === "night" || world.phase === "dusk") && option.place === person.home) score += 45;
    if ((world.weather === "rain" || world.weather === "storm") && placeOf(option.place).shelter) score += 14;
    if (person.hunger > 70 && option.place === person.home) score += 30;
    const partner = person.matter ? world.people.find((other) => other.id === person.matter?.withId && other.alive) : null;
    if (partner && option.place === partner.place && person.hunger < 78 && person.energy > 28 && world.phase !== "night") score += 55;
    if (world.phase === "night" && person.band !== "adult") score -= 30;
  }
  return score;
}

function foodOf(world: World, person: Person): number {
  const storage = world.storages[person.household];
  return (storage?.grain ?? 0) + (storage?.berries ?? 0);
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

function utteranceFor(
  person: Person,
  world: World,
  option: StepOption,
): Pick<Decision, "speak" | "audience" | "listenerId" | "intentWord" | "topic" | "tone"> {
  const intents = allowedIntentIds(person.band);
  const topics = allowedTopicIds(person.band);
  const tones = allowedToneIds(person.band);
  const roll = (world.tick + hashName(person.id)) % 8;
  let speak = option.kind === "express" || person.distress || person.hunger > 68 || person.belonging < 36 || roll === 0;
  let intentWord = "tell";
  let topic = "work";
  let tone = "soft";

  const node = option.nodeId ? nodeById(world.nodes, option.nodeId) : null;

  if (person.distress || option.id === "cry") {
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
  } else if (world.weather === "rain" || world.weather === "storm") {
    intentWord = "tell";
    topic = "rain";
    tone = "rain";
  } else if (option.kind === "play") {
    intentWord = "play";
    topic = "play";
    tone = "joy";
  } else if (option.kind === "harvest" && node?.kind === "crop") {
    intentWord = "work";
    topic = "crop";
    tone = "soft";
  } else if (option.kind === "harvest" || option.kind === "plant") {
    intentWord = "work";
    topic = "food";
    tone = "soft";
  } else if (option.kind === "chop" || option.kind === "mine" || option.kind === "build") {
    intentWord = "work";
    topic = "wood";
    tone = "soft";
  } else if (option.kind === "eat") {
    intentWord = "eat";
    topic = "food";
    tone = "please";
  } else if (option.kind === "teach" || option.kind === "learn") {
    intentWord = "look";
    topic = "work";
    tone = "ask";
  } else if (option.kind === "care") {
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
  const place = placeOf("square");
  if (
    dist(person, { x: place.x, y: place.y }) <= place.r &&
    (person.band === "adult" || person.band === "elder") &&
    (world.weather === "rain" || world.phase === "dusk") &&
    roll === 0
  ) {
    audience = "town";
    intentWord = world.weather === "rain" ? "danger" : "tell";
    if (!intents.includes(intentWord)) intentWord = "tell";
  }

  if (option.kind !== "express" && !person.distress && option.id !== "cry" && roll !== 0 && person.hunger <= 68 && person.belonging >= 36) {
    speak = false;
  }

  return { speak, audience, listenerId, intentWord, topic, tone };
}

export function reflexDecide(world: World, personId: string): Decision {
  const person = world.people.find((item) => item.id === personId);
  if (!person) {
    return {
      personId,
      stepId: "rest",
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
  const steps = legalSteps(person, world);
  const chosen = steps.slice().sort((left, right) => scoreStep(person, world, right) - scoreStep(person, world, left))[0];
  if (!chosen) {
    return {
      personId,
      stepId: "rest",
      speak: false,
      audience: "here",
      listenerId: null,
      intentWord: "stay",
      topic: "home",
      tone: "soft",
      because: "nothing legal to do",
      source: "reflex",
      confidence: null,
    };
  }
  const speech = utteranceFor(person, world, chosen);
  const reason = `${person.self.temper.split(",")[0]}; ${chosen.label.toLowerCase()}`;
  return {
    personId: person.id,
    stepId: chosen.id,
    because: reason,
    source: "reflex",
    confidence: null,
    ...speech,
  };
}
