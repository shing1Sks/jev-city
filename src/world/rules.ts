import { pathLength, placeOf } from "./map.js";
import type { ActionKind, ActionOption, Person, PlaceId, World } from "./types.js";

const HEAVY = new Set<ActionKind>(["farm", "haul", "watch"]);

export function customBonus(person: Person, kind: ActionKind): number {
  if (person.band === "elder" && (kind === "teach" || kind === "speak")) return 18;
  if (person.band === "toddler" || person.band === "child" || person.band === "youth") {
    if (kind === "play" || kind === "learn") return 12;
    if (person.gender === "male" && (kind === "forage" || kind === "farm")) return 8;
    if (person.gender === "female" && (kind === "cook" || kind === "mend" || kind === "care")) return 8;
    return 0;
  }
  if (person.gender === "male" && (kind === "farm" || kind === "haul" || kind === "watch")) return 14;
  if (person.gender === "female" && (kind === "cook" || kind === "mend" || kind === "heal" || kind === "forage" || kind === "care")) {
    return 14;
  }
  return 0;
}

export function skillFor(kind: ActionKind): "farm" | "cook" | "mend" | "forage" | "haul" | "heal" | "teach" | "play" | null {
  switch (kind) {
    case "farm":
      return "farm";
    case "cook":
      return "cook";
    case "mend":
      return "mend";
    case "forage":
      return "forage";
    case "haul":
      return "haul";
    case "heal":
      return "heal";
    case "teach":
    case "learn":
      return "teach";
    case "play":
      return "play";
    default:
      return null;
  }
}

export function isCovered(person: Person, world: World): boolean {
  return world.people.some(
    (other) =>
      other.household === person.household &&
      other.id !== person.id &&
      other.place === person.place &&
      (other.band === "youth" || other.band === "adult" || other.band === "elder"),
  );
}

export function isDistressed(person: Person, world: World): boolean {
  return person.band === "toddler" && !isCovered(person, world);
}

export function nightSafe(person: Person, world: World): boolean {
  if (person.place === person.home) return true;
  if (person.band === "youth" && person.place === "porch") return true;
  return world.people.some(
    (other) =>
      person.guardians.includes(other.id) &&
      other.place === person.place &&
      (other.band === "youth" || other.band === "adult" || other.band === "elder"),
  );
}

export function underCurfew(person: Person, world: World): boolean {
  if (world.phase !== "night") return false;
  if (person.band !== "child" && person.band !== "youth") return false;
  return !nightSafe(person, world);
}

function capable(world: World, household: string): Person[] {
  return world.people.filter(
    (person) =>
      person.household === household &&
      (person.band === "youth" || person.band === "adult" || person.band === "elder"),
  );
}

/** Closest capable household member, stable by id when distances tie. */
export function assignedToddler(person: Person, world: World): Person | null {
  if (person.band === "toddler" || person.band === "child") return null;
  const toddlers = world.people.filter(
    (other) => other.household === person.household && other.band === "toddler" && (isDistressed(other, world) || (world.phase === "night" && other.place !== other.home)),
  );
  if (toddlers.length === 0) return null;
  const toddler = toddlers[0];
  if (!toddler) return null;
  const ranked = capable(world, toddler.household)
    .map((candidate) => ({ candidate, distance: pathLength(candidate.place, toddler.place) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.id.localeCompare(right.candidate.id));
  if (ranked[0]?.candidate.id !== person.id) return null;
  return toddler;
}

export function option(id: string, kind: ActionKind, label: string, detail: string, place: PlaceId | null = null, escort = false): ActionOption {
  return { id, kind, label, detail, place, escort };
}

export function goOption(place: PlaceId, escort = false): ActionOption {
  const name = placeOf(place).name;
  return option(`go_${place}`, "go", `Go to ${name}`, `Walk to ${name}.`, place, escort);
}

export function forcedAction(person: Person, world: World): ActionOption | null {
  if (underCurfew(person, world)) return goOption(person.home);
  if (person.band === "toddler" && isDistressed(person, world)) {
    return option("cry", "stay", "Cry for help", "Stay and call for a guardian.", null);
  }
  const toddler = assignedToddler(person, world);
  if (!toddler) return null;
  if (person.place !== toddler.place) return goOption(toddler.place);
  if (world.phase === "night" && toddler.place !== toddler.home) return goOption(toddler.home, true);
  if (isDistressed(toddler, world)) return option("care", "care", "Care", "Settle the toddler.", null);
  return null;
}

function at(person: Person, ...places: PlaceId[]): boolean {
  return places.includes(person.place);
}

export function legalActions(person: Person, world: World): ActionOption[] {
  const forced = forcedAction(person, world);
  if (forced) return [forced];

  const day = world.phase === "day" || world.phase === "dawn" || world.phase === "dusk";
  const food = world.food[person.household] ?? 0;
  const acts: ActionOption[] = [option("stay", "stay", "Stay", "Remain here and watch.")];

  if (person.band !== "toddler") {
    for (const place of ["grove", "field", "well", "vale", "square", "hearth", "market", "porch"] as PlaceId[]) {
      if (place !== person.place) {
        const escort = place === person.home && world.people.some(
          (kid) => kid.band === "toddler" && kid.household === person.household && kid.place === person.place && kid.place !== kid.home,
        );
        acts.push(goOption(place, escort));
      }
    }
  }

  const work = (kind: ActionKind, label: string, detail: string) => {
    acts.push(option(kind, kind, label, detail));
  };

  if (food > 0 && person.hunger > 20 && at(person, person.home, "hearth")) work("eat", "Eat", "Eat from the household store.");
  if (person.energy < 85) work("rest", "Rest", "Sit and recover.");
  if (at(person, person.home) && (world.phase === "night" || world.phase === "dawn" || person.energy < 35)) {
    work("sleep", "Sleep", "Sleep at home.");
  }
  work("speak", "Speak", "Say something in the town lexicon.");

  if (person.band === "toddler") {
    if (at(person, person.home, "square")) work("play", "Play", "Play where they stand.");
    return trimHeavy(person, acts);
  }

  if (person.band === "child") {
    if (day && at(person, person.home, "square", "field", "grove")) work("play", "Play", "Play nearby.");
    if (day) work("learn", "Learn", "Watch and practice.");
    if (day && person.place === "grove" && person.choresToday < 2) work("forage", "Forage", "A light gathering chore.");
    return trimHeavy(person, acts);
  }

  if (person.band === "youth") {
    if (day && at(person, person.home, "square", "field")) work("play", "Play", "Play with the younger ones.");
    work("learn", "Learn", "Practice a skill.");
    if (person.place === "field") work("farm", "Farm", "Apprentice field work.");
    if (person.place === "hearth") work("cook", "Cook", "Help at the hearth.");
    if (person.place === "market") work("mend", "Mend", "Mend cloth at the loft.");
    if (person.place === "grove") work("forage", "Forage", "Gather from the grove.");
    work("heal", "Heal", "Tend someone worn down.");
    maybeCare(person, world, acts);
    return trimHeavy(person, acts);
  }

  if (person.band === "elder") {
    if (person.place === "hearth") work("cook", "Cook", "A light pot.");
    if (person.place === "market") work("mend", "Mend", "Slow careful mending.");
    if (person.place === "grove") work("forage", "Forage", "Light gathering.");
    if (at(person, "porch", "square")) work("teach", "Teach", "Give a lesson.");
    work("heal", "Heal", "Tend someone worn down.");
    maybeCare(person, world, acts);
    return trimHeavy(person, acts);
  }

  if (person.place === "field") work("farm", "Farm", "Work the field.");
  if (person.place === "field" && person.energy > 25) work("haul", "Haul", "Carry stores home in spirit: add to the larder.");
  if (person.place === "hearth") work("cook", "Cook", "Cook at the hearth.");
  if (person.place === "market") work("mend", "Mend", "Mend at the loft.");
  if (person.place === "grove") work("forage", "Forage", "Forage the grove.");
  if (at(person, "porch", "square") && person.skills.teach >= 30) work("teach", "Teach", "Teach whoever is listening.");
  work("heal", "Heal", "Tend someone worn down.");
  if ((world.phase === "night" || world.phase === "dusk") && person.place === "square") work("watch", "Watch", "Keep the square.");
  maybeCare(person, world, acts);
  return trimHeavy(person, acts);
}

function maybeCare(person: Person, world: World, acts: ActionOption[]): void {
  const kid = world.people.find(
    (other) => other.band === "toddler" && other.household === person.household && other.place === person.place && (other.hunger > 40 || other.belonging < 45),
  );
  if (kid) acts.push(option("care", "care", "Care", "Feed and settle the toddler."));
}

function trimHeavy(person: Person, acts: ActionOption[]): ActionOption[] {
  if (person.energy >= 15) return dedupe(acts);
  return dedupe(acts.filter((act) => !HEAVY.has(act.kind)));
}

function dedupe(acts: ActionOption[]): ActionOption[] {
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
    lines.push("Stays with a household youth or adult. Cannot walk the town alone. Speech is a handful of words. If left, they cry and the nearest guardian must come.");
  } else if (person.band === "child") {
    lines.push("Play, lessons, and at most two light gathering chores in a day. No tools, hauling, trade, or night watch. Home by night unless a guardian is with them.");
  } else if (person.band === "youth") {
    lines.push("Apprentice work is allowed. No heavy haul and no night watch. No town-wide announcement. Home, or the elder porch, by night.");
  } else if (person.band === "adult") {
    lines.push("Full work, care, and night watch. May announce to the whole town from the square. May speak in private.");
  } else {
    lines.push("No field labor, hauling, or watch. Teaching, mending, and counsel come first. May announce from the square.");
  }
  if (person.gender === "male") {
    lines.push("Jevhold custom, a preference only: when two acts are close, men lean to the field, hauling, and the watch.");
  } else {
    lines.push("Jevhold custom, a preference only: when two acts are close, women lean to the hearth, mending, healing, forage, and care.");
  }
  if (person.band === "child" || person.band === "youth") {
    lines.push("Among children, outdoor chores lean toward boys and hearth chores toward girls. A stronger skill still wins.");
  }
  if (person.household === "market" && person.band !== "toddler" && person.band !== "child") {
    lines.push("If Jevik is left alone, the nearest capable person in the Market household goes to him and brings him home at night.");
  }
  return lines;
}
