import { regionAt } from "./grid.js";
import { placeOf } from "./map.js";
import { deplete, nodeById } from "./nodes.js";
import type { Animal, AnimalMove, CityEvent, ResourceNode, World } from "./types.js";
import { GRID_H, GRID_W, clamp, dist, roll } from "./types.js";

/**
 * Wild bodies, no minds worth the word. Movement, fear, hunger, and every
 * effect live here in plain code, inside the town tick. A laya urge (animal
 * .bias) is honored when legal; the instincts decide otherwise. Animals never
 * speak, never take tasks, never enter bonds or memory — but crows really do
 * eat from the same bushes the town harvests.
 */

const CAST: { kind: Animal["kind"]; count: number; anchor: { x: number; y: number } }[] = [
  { kind: "crow", count: 3, anchor: { x: 30, y: 30 } },
  { kind: "deer", count: 2, anchor: { x: 16, y: 22 } },
  { kind: "dog", count: 1, anchor: { x: 50, y: 50 } },
];

const SPEED: Record<Animal["kind"], { drift: number; flee: number }> = {
  crow: { drift: 0.9, flee: 1.3 },
  deer: { drift: 0.35, flee: 1.2 },
  dog: { drift: 0.55, flee: 0.9 },
};

const FEAR_RADIUS: Record<Animal["kind"], number> = { crow: 3.5, deer: 6, dog: 0 };
const FEAR_THRESHOLD: Record<Animal["kind"], number> = { crow: 30, deer: 25, dog: 101 };

const LEGAL: Record<Animal["kind"], AnimalMove[]> = {
  crow: ["wander", "steal", "flee", "rest"],
  deer: ["wander", "graze", "flee", "rest"],
  dog: ["wander", "follow", "flee", "rest"],
};

/** Crows and deer bed down when the town sleeps; the dog naps at the square. */
function restingNow(world: World, animal: Animal): boolean {
  if (animal.kind === "dog") return world.phase === "night" && dist(animal, placeOf("square")) < 8;
  return world.phase === "night";
}

function nearestPerson(world: World, animal: Animal): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  for (const person of world.people) {
    if (!person.alive || person.band === "toddler") continue;
    const d = dist(person, animal);
    if (!best || d < best.d) best = { id: person.id, d };
  }
  return best;
}

function nearestRipeBerry(nodes: ResourceNode[], at: Animal, within: number): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestDistance = within;
  for (const node of nodes) {
    if (node.kind !== "berry" || node.stage < node.maxStage) continue;
    const d = dist(node, at);
    if (d < bestDistance) {
      best = node;
      bestDistance = d;
    }
  }
  return best;
}

function headToward(animal: Animal, dest: { x: number; y: number }, kind: AnimalMove, world: World, extra: { nodeId?: string; personId?: string } = {}): void {
  animal.step = { kind, dest, untilTick: world.tick + (kind === "follow" ? 4 : 30), ...extra };
}

function wanderDest(world: World, animal: Animal, spread: number): { x: number; y: number } {
  const angle = roll(world) * Math.PI * 2;
  const radius = 3 + roll(world) * spread;
  return {
    x: clamp(animal.x + Math.cos(angle) * radius, 3, GRID_W - 3),
    y: clamp(animal.y + Math.sin(angle) * radius, 5, GRID_H - 5),
  };
}

/** The instinct fallback: what the animal does when nobody is suggesting anything. */
function instinct(world: World, animal: Animal): AnimalMove {
  if (restingNow(world, animal)) return "rest";
  const near = nearestPerson(world, animal);
  if (near && near.d <= FEAR_RADIUS[animal.kind] && animal.fear >= FEAR_THRESHOLD[animal.kind] * 0.7) return "flee";
  if (animal.kind === "crow") {
    if (animal.hunger > 35 && nearestRipeBerry(world.nodes, animal, 30)) return "steal";
    return "wander";
  }
  if (animal.kind === "deer") {
    if (animal.hunger > 45) return "graze";
    return "wander";
  }
  const friend = nearestPerson(world, animal);
  if (friend && friend.d <= 45) return "follow";
  return "wander";
}

function beginMove(world: World, animal: Animal, move: AnimalMove): void {
  const speed = SPEED[animal.kind];
  if (move === "rest") {
    animal.step = { kind: "rest", dest: null, untilTick: world.tick + 40 };
    return;
  }
  if (move === "flee") {
    const near = nearestPerson(world, animal);
    const threat = near ? world.people.find((item) => item.id === near.id) : null;
    let dx = animal.x - (threat?.x ?? animal.x);
    let dy = animal.y - (threat?.y ?? animal.y);
    if (dx === 0 && dy === 0) {
      const angle = roll(world) * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
    }
    const d = Math.hypot(dx, dy) || 1;
    animal.step = {
      kind: "flee",
      dest: {
        x: clamp(animal.x + (dx / d) * 14, 3, GRID_W - 3),
        y: clamp(animal.y + (dy / d) * 14, 5, GRID_H - 5),
      },
      untilTick: world.tick + 25,
    };
    return;
  }
  if (move === "steal") {
    const node = nearestRipeBerry(world.nodes, animal, 34);
    if (node) headToward(animal, { x: node.x, y: node.y }, "steal", world, { nodeId: node.id });
    else headToward(animal, wanderDest(world, animal, 14), "wander", world);
    return;
  }
  if (move === "graze") {
    headToward(animal, wanderDest(world, animal, 4), "graze", world);
    return;
  }
  if (move === "follow") {
    const friend = nearestPerson(world, animal);
    if (friend) {
      const person = world.people.find((item) => item.id === friend.id);
      if (person) headToward(animal, { x: person.x, y: person.y }, "follow", world, { personId: person.id });
      return;
    }
  }
  headToward(animal, wanderDest(world, animal, animal.kind === "deer" ? 10 : 14), "wander", world);
}

function witnessedStealLog(world: World, animal: Animal, node: ResourceNode): void {
  const seen = world.people.some((person) => person.alive && dist(person, animal) <= 12);
  if (!seen || roll(world) >= 0.5) return;
  const at = regionAt(animal);
  const event: CityEvent = {
    id: world.nextEventId,
    tick: world.tick,
    clock: `${String(world.hour).padStart(2, "0")}:${String(world.minute).padStart(2, "0")}`,
    kind: "move",
    speakerId: null,
    audience: null,
    listenerId: null,
    place: at,
    text: `A ${animal.kind} picks the ripe berries${at ? ` by ${placeOf(at).name}` : ""}.`,
    heardBy: world.people.filter((person) => person.alive && dist(person, animal) <= 12).map((person) => person.id),
  };
  world.log.push(event);
  world.nextEventId += 1;
}

function arrive(world: World, animal: Animal): void {
  const step = animal.step;
  if (!step) return;
  if (step.kind === "steal") {
    const node = step.nodeId ? nodeById(world.nodes, step.nodeId) : null;
    if (node && node.kind === "berry" && node.stage >= node.maxStage) {
      deplete(node);
      animal.hunger = clamp(animal.hunger - 30, 0, 100);
      witnessedStealLog(world, animal, node);
    }
  } else if (step.kind === "graze") {
    animal.hunger = clamp(animal.hunger - 25, 0, 100);
  }
  animal.step = null;
}

function moveAnimal(world: World, animal: Animal): void {
  const step = animal.step;
  if (!step?.dest) {
    if (step && world.tick > step.untilTick) animal.step = null;
    return;
  }
  const fleeing = step.kind === "flee";
  const speed = fleeing ? SPEED[animal.kind].flee : SPEED[animal.kind].drift;
  const dx = step.dest.x - animal.x;
  const dy = step.dest.y - animal.y;
  const d = Math.hypot(dx, dy);
  if (d <= Math.max(0.6, speed)) {
    animal.x = step.dest.x;
    animal.y = step.dest.y;
    if (world.tick >= step.untilTick || step.kind !== "follow") arrive(world, animal);
    return;
  }
  animal.x += (dx / d) * speed;
  animal.y += (dy / d) * speed;
  animal.facing = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "front" : "back";
  if (world.tick > step.untilTick) animal.step = null;
}

/** One town tick for the wildlife. Called from tick() after the people pass. */
export function tickAnimals(world: World): void {
  if (world.animals.length === 0) return;
  for (const animal of world.animals) {
    animal.fear = clamp(animal.fear - 0.4, 0, 100);
    animal.hunger = clamp(animal.hunger + 0.05, 0, 100);

    const near = nearestPerson(world, animal);
    const radius = FEAR_RADIUS[animal.kind];
    if (near && near.d <= radius) animal.fear = clamp(animal.fear + (radius - near.d) * 6, 0, 100);

    const fleeing = animal.step?.kind === "flee";
    if (!fleeing && near && near.d <= radius && animal.fear >= FEAR_THRESHOLD[animal.kind]) {
      animal.step = null;
      beginMove(world, animal, "flee");
      moveAnimal(world, animal);
      continue;
    }

    if (!animal.step || world.tick > animal.step.untilTick) {
      const bias = animal.bias && animal.bias.untilTick > world.tick ? animal.bias : null;
      let move = instinct(world, animal);
      if (bias && bias.kind !== move && LEGAL[animal.kind].includes(bias.kind)) {
        // A laya urge wins unless it is impossible for this body right now.
        if (bias.kind !== "steal" || nearestRipeBerry(world.nodes, animal, 34)) move = bias.kind;
      }
      beginMove(world, animal, move);
    }
    moveAnimal(world, animal);
  }
}

export function spawnAnimals(world: World): Animal[] {
  const animals: Animal[] = [];
  for (const spec of CAST) {
    for (let index = 0; index < spec.count; index += 1) {
      animals.push({
        id: `${spec.kind}-${index}`,
        kind: spec.kind,
        name: spec.kind,
        x: clamp(spec.anchor.x + (roll(world) - 0.5) * 16, 3, GRID_W - 3),
        y: clamp(spec.anchor.y + (roll(world) - 0.5) * 16, 5, GRID_H - 5),
        facing: "front",
        fear: 0,
        hunger: 20 + roll(world) * 30,
        step: null,
        bias: null,
      });
    }
  }
  return animals;
}
