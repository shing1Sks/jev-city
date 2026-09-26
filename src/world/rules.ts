import { centerOf, placeOf } from "./map.js";
import type { Band, Item, Person, PlaceId, ResourceNode, StepOption, World } from "./types.js";
import { carryCount, dist } from "./types.js";
import { siteNeeds } from "./construction.js";

/**
 * Law is ordinary code and stays that way. Bands are hard limits on the step
 * list; custom is a preference the scorer (reflex now, spine later) may weigh.
 * Nothing here calls a model.
 */

const CAPABLE: Band[] = ["youth", "adult", "elder"];

export function capableMember(person: Person): boolean {
  return CAPABLE.includes(person.band);
}

export function isCovered(person: Person, world: World): boolean {
  return world.people.some(
    (other) =>
      other.alive &&
      other.id !== person.id &&
      other.household === person.household &&
      capableMember(other) &&
      dist(other, person) <= 3.5,
  );
}

export function isDistressed(person: Person, world: World): boolean {
  return person.band === "toddler" && !isCovered(person, world);
}

export function nightSafe(person: Person, world: World): boolean {
  const home = placeOf(person.home);
  if (dist(person, { x: home.x, y: home.y }) <= home.r + 3) return true;
  if (person.band === "youth") {
    const porch = placeOf("porch");
    if (dist(person, { x: porch.x, y: porch.y }) <= porch.r + 2) return true;
  }
  return world.people.some(
    (other) =>
      other.alive &&
      person.guardians.includes(other.id) &&
      capableMember(other) &&
      dist(other, person) <= 3.5,
  );
}

export function underCurfew(person: Person, world: World): boolean {
  if (world.phase !== "night") return false;
  if (person.band !== "child" && person.band !== "youth") return false;
  return !nightSafe(person, world);
}

function capableOf(household: string, world: World): Person[] {
  return world.people.filter((person) => person.alive && person.household === household && capableMember(person));
}

/** Closest capable household member to a toddler in need, stable by id on ties. */
export function assignedToddler(person: Person, world: World): Person | null {
  if (!capableMember(person)) return null;
  const toddlers = world.people.filter(
    (other) =>
      other.alive &&
      other.household === person.household &&
      other.band === "toddler" &&
      (isDistressed(other, world) || (world.phase === "night" && dist(other, centerOf(other.home)) > placeOf(other.home).r + 3)),
  );
  const toddler = toddlers[0];
  if (!toddler) return null;
  const ranked = capableOf(toddler.household, world)
    .map((candidate) => ({ candidate, distance: dist(candidate, toddler) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.id.localeCompare(right.candidate.id));
  if (ranked[0]?.candidate.id !== person.id) return null;
  return toddler;
}

export function stepOption(
  id: string,
  kind: StepOption["kind"],
  label: string,
  detail: string,
  extra: Partial<StepOption> = {},
): StepOption {
  return { id, kind, label, detail, ...extra };
}

/** Law-forced steps override every choice: crying, curfew, guardian duty. */
export function forcedStep(person: Person, world: World): StepOption | null {
  if (underCurfew(person, world)) {
    return stepOption("go_home", "walk", "Go home", "Curfew: walk home.", { place: person.home, dest: centerOf(person.home) });
  }
  // The ill keep to home and rest (unless hunger forces the walk to the pantry).
  if (person.ill && person.hunger <= 70) {
    if (!nearHome(person, 3)) {
      return stepOption("go_home", "walk", "Go home", "Unwell: home to rest.", { place: person.home, dest: centerOf(person.home) });
    }
    return stepOption("rest", "rest", "Rest, unwell", "Sick: rest until it passes.");
  }
  if (person.band === "toddler" && isDistressed(person, world)) {
    return stepOption("cry", "express", "Cry for help", "Left without a guardian.");
  }
  const toddler = assignedToddler(person, world);
  if (!toddler) return null;
  if (dist(person, toddler) > 1.8) {
    return stepOption(`go_${toddler.id}`, "walk", `Go to ${toddler.name}`, "A toddler of the household needs someone.", { toId: toddler.id, dest: { x: toddler.x, y: toddler.y } });
  }
  const toddlerHome = centerOf(toddler.home);
  const outLate = world.phase === "night" && dist(toddler, toddlerHome) > placeOf(toddler.home).r + 3;
  if (outLate) {
    return stepOption(`lead_${toddler.id}`, "walk", `Bring ${toddler.name} home`, "Lead the toddler home by the hand.", { toId: toddler.id, leadId: toddler.id, dest: toddlerHome });
  }
  if (isDistressed(toddler, world)) {
    return stepOption(`care_${toddler.id}`, "care", `Settle ${toddler.name}`, "Stay and settle the toddler.", { toId: toddler.id });
  }
  return null;
}

function atRegion(person: Person, id: PlaceId, slack = 2): boolean {
  const place = placeOf(id);
  return dist(person, { x: place.x, y: place.y }) <= place.r + slack;
}

export function nearHome(person: Person, slack = 2): boolean {
  return atRegion(person, person.home, slack);
}

/** Nodes worth working, ranked by usefulness then distance. */
export function workableNodes(world: World, person: Person, kinds: ResourceNode["kind"][], range = 60): ResourceNode[] {
  return world.nodes
    .filter((node) => {
      if (!kinds.includes(node.kind)) return false;
      if (node.kind === "crop") return node.stage >= node.maxStage || node.stage === 0;
      return node.stage > 0;
    })
    .map((node) => ({ node, distance: dist(person, node) }))
    .filter((entry) => entry.distance <= range)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 6)
    .map((entry) => entry.node);
}

/**
 * Every legal step this person could take right now. Law has already removed
 * what their band forbids; the spine (or the provisional reflex) only ever
 * chooses from this list.
 */
export function legalSteps(person: Person, world: World): StepOption[] {
  const forced = forcedStep(person, world);
  if (forced) return [forced];

  const acts: StepOption[] = [];
  const day = world.phase !== "night";

  // Walking is free for everyone old enough; toddlers are led, never alone.
  // At night the young may only head for home (youth may also take the porch).
  if (person.band !== "toddler") {
    const nightBound = (person.band === "child" || person.band === "youth") && world.phase === "night";
    for (const id of ["grove", "mill", "field", "well", "vale", "square", "hearth", "market", "rise", "porch"] as PlaceId[]) {
      if (nightBound && id !== person.home && !(person.band === "youth" && id === "porch")) continue;
      if (!atRegion(person, id, 0)) {
        acts.push(stepOption(`walk_${id}`, "walk", `Walk to ${placeOf(id).name}`, `Head toward ${placeOf(id).name}.`, { place: id, dest: centerOf(id) }));
      }
    }
  }

  acts.push(stepOption("rest", "rest", "Rest", "Sit and recover."));
  if (nearHome(person) && (world.phase === "night" || world.phase === "dawn" || person.energy < 30)) {
    acts.push(stepOption("sleep", "sleep", "Sleep", "Sleep at home."));
  }
  acts.push(stepOption("express", "express", "Express", "Show a feeling in the town lexicon."));

  if (person.band === "toddler") {
    if (atRegion(person, person.home) || atRegion(person, "square")) {
      acts.push(stepOption("play", "play", "Play", "Play where they stand."));
    }
    return dedupe(acts);
  }

  // A promise made in conversation rides the legal list until it is kept;
  // choosing it is still the spine's (or reflex's) decision, never forced.
  const owed = person.owe;
  const owedTarget = owed ? world.people.find((item) => item.id === owed.toId && item.alive) : null;
  if (owed && owedTarget) {
    acts.push(
      stepOption(`give_${owedTarget.id}`, "give", `Bring ${owed.qty} ${owed.item} to ${owedTarget.name}`, "A favor promised in conversation.", { toId: owedTarget.id }),
    );
  }

  const storage = world.storages[person.household];
  const handFood = (person.carry.grain ?? 0) + Math.floor((person.carry.berries ?? 0) / 2);
  if (person.hunger > 25 && (storage?.grain ?? 0) + (storage?.berries ?? 0) + handFood > 0) {
    acts.push(stepOption("eat", "eat", "Eat", "Take a meal — from the hand if it holds food, else the household store."));
  }
  if (carryCount(person.carry) > 0) {
    acts.push(stepOption("store", "store", "Store goods", "Carry what you hold to the household store."));
  }

  if (person.band === "child") {
    if (day && (nearHome(person) || atRegion(person, "square") || atRegion(person, "field"))) {
      acts.push(stepOption("play", "play", "Play", "Play nearby."));
    }
    acts.push(stepOption("learn", "learn", "Learn", "Watch and practice."));
    if (day && person.choresToday < 2) {
      for (const node of workableNodes(world, person, ["berry"])) {
        acts.push(stepOption(`harvest_${node.id}`, "harvest", "Pick berries", "A light gathering chore.", { nodeId: node.id }));
      }
    }
    return dedupe(acts);
  }

  if (person.band === "youth") {
    if (day) acts.push(stepOption("play", "play", "Play", "Play with the younger ones."));
    acts.push(stepOption("learn", "learn", "Learn", "Practice a skill."));
    for (const node of workableNodes(world, person, ["berry"])) {
      acts.push(stepOption(`harvest_${node.id}`, "harvest", "Pick berries", "Gather from the bush.", { nodeId: node.id }));
    }
    for (const node of workableNodes(world, person, ["crop"]).filter((item) => item.stage >= item.maxStage)) {
      acts.push(stepOption(`harvest_${node.id}`, "harvest", "Harvest the crop", "Cut and bind the grain.", { nodeId: node.id }));
    }
    for (const node of workableNodes(world, person, ["crop"]).filter((item) => item.stage === 0)) {
      acts.push(stepOption(`plant_${node.id}`, "plant", "Sow the plot", "Put seed to soil.", { nodeId: node.id }));
    }
    for (const node of workableNodes(world, person, ["tree"])) {
      acts.push(stepOption(`chop_${node.id}`, "chop", "Chop wood", "Fell limbs for the stack.", { nodeId: node.id }));
    }
    maybeCare(person, world, acts);
    return dedupe(acts);
  }

  if (person.band === "elder") {
    for (const node of workableNodes(world, person, ["berry"])) {
      acts.push(stepOption(`harvest_${node.id}`, "harvest", "Pick berries", "Light gathering.", { nodeId: node.id }));
    }
    for (const node of workableNodes(world, person, ["crop"])) {
      if (node.stage >= node.maxStage) acts.push(stepOption(`harvest_${node.id}`, "harvest", "Harvest the crop", "Cut and bind the grain.", { nodeId: node.id }));
      if (node.stage === 0) acts.push(stepOption(`plant_${node.id}`, "plant", "Sow the plot", "Put seed to soil.", { nodeId: node.id }));
    }
    if (atRegion(person, "porch", 3) || atRegion(person, "square", 3)) {
      acts.push(stepOption("teach", "teach", "Teach", "Give a lesson to whoever is near."));
    }
    maybeCare(person, world, acts);
    appendBuildSteps(person, world, acts);
    return dedupe(acts);
  }

  // adults
  for (const node of workableNodes(world, person, ["tree"])) {
    acts.push(stepOption(`chop_${node.id}`, "chop", "Chop wood", "Fell limbs for the stack.", { nodeId: node.id }));
  }
  for (const node of workableNodes(world, person, ["rock"])) {
    acts.push(stepOption(`mine_${node.id}`, "mine", "Mine stone", "Break stone from the outcrop.", { nodeId: node.id }));
  }
  for (const node of workableNodes(world, person, ["berry"])) {
    acts.push(stepOption(`harvest_${node.id}`, "harvest", "Pick berries", "Gather from the bush.", { nodeId: node.id }));
  }
  for (const node of workableNodes(world, person, ["crop"])) {
    if (node.stage >= node.maxStage) acts.push(stepOption(`harvest_${node.id}`, "harvest", "Harvest the crop", "Cut and bind the grain.", { nodeId: node.id }));
    if (node.stage === 0) acts.push(stepOption(`plant_${node.id}`, "plant", "Sow the plot", "Put seed to soil.", { nodeId: node.id }));
  }
  if (atRegion(person, "porch", 3) || atRegion(person, "square", 3)) {
    if (person.skills.teach >= 30) acts.push(stepOption("teach", "teach", "Teach", "Teach whoever is listening."));
  }
  maybeCare(person, world, acts);
  appendBuildSteps(person, world, acts);
  return dedupe(acts);
}

function maybeCare(person: Person, world: World, acts: StepOption[]): void {
  const kid = world.people.find(
    (other) =>
      other.alive &&
      other.band === "toddler" &&
      other.household === person.household &&
      dist(other, person) <= 3.5 &&
      (other.hunger > 40 || other.belonging < 45),
  );
  if (kid) acts.push(stepOption(`care_${kid.id}`, "care", `Care for ${kid.name}`, "Feed and settle the toddler.", { toId: kid.id }));
}

/** Building options: deliver to a marked site, raise its walls, or mark a new one. */
function appendBuildSteps(person: Person, world: World, acts: StepOption[]): void {
  for (const site of world.sites) {
    if (site.ownerId !== person.id) continue;
    if (site.stage >= site.stages) continue;
    if (siteNeeds(site) <= 0) {
      acts.push(stepOption(`build_${site.id}`, "build", `Raise the ${site.kind}`, "Work the materials already lying there.", { siteId: site.id }));
      continue;
    }
    const storage = world.storages[person.household];
    const canFurnish = (Object.keys(site.need) as Item[]).some(
      (item) =>
        (site.need[item] ?? 0) > (site.have[item] ?? 0) &&
        (storage?.[item] ?? 0) + (person.carry[item] ?? 0) > 0,
    );
    if (canFurnish) {
      acts.push(stepOption(`deliver_${site.id}`, "store", `Carry materials to the ${site.kind}`, "Walk what the site still owes to it.", { siteId: site.id }));
    }
  }
}

function dedupe(acts: StepOption[]): StepOption[] {
  const seen = new Set<string>();
  return acts.filter((act) => {
    if (seen.has(act.id)) return false;
    seen.add(act.id);
    return true;
  });
}

export function lawLines(person: Pick<Person, "band" | "age" | "gender" | "household">): string[] {
  const lines = [`${person.band}, age ${person.age}`];
  if (person.band === "toddler") {
    lines.push("Stays within sight of a household youth or adult. Cannot walk the town alone. Speech is a handful of words. If left, they cry and the nearest guardian must come.");
  } else if (person.band === "child") {
    lines.push("Play, lessons, and at most two light gathering chores in a day. No axes, no quarry work, hauling only what small hands carry. Home by night unless a guardian is with them.");
  } else if (person.band === "youth") {
    lines.push("Apprentice work is allowed: wood, berries, crops. No quarry stone and no night watch. No town-wide announcement. Home, or the elder porch, by night.");
  } else if (person.band === "adult") {
    lines.push("Full work: wood, stone, crops, building, care, and night watch. May announce to the whole town from the square. May speak in private.");
  } else {
    lines.push("No felling and no quarry work. Teaching, gathering, sowing, and counsel come first. May announce from the square.");
  }
  if (person.gender === "male") {
    lines.push("Jevhold custom, a preference only: when two acts are close, men lean to timber, stone, and the watch.");
  } else {
    lines.push("Jevhold custom, a preference only: when two acts are close, women lean to the hearth, mending, healing, forage, and care.");
  }
  return lines;
}
