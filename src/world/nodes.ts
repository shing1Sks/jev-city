import { PLACES } from "./map.js";
import type { NodeKind, ResourceNode, Vec, Weather } from "./types.js";
import { GRID_H, GRID_W, dist, roll } from "./types.js";

/**
 * Resource nodes: trees, rocks, berry bushes, crop plots. Scattered by the
 * seeded world RNG (clustering toward their natural regions), depleted by
 * work, regrown by daily rolls. Nothing here calls a model.
 */

export const NODE_LIMITS: Record<NodeKind, number> = {
  tree: 26,
  rock: 16,
  berry: 16,
  crop: 12,
};

interface SpawnSpec {
  kind: NodeKind;
  count: number;
  /** Anchor regions with weight; higher weight = denser. */
  anchors: { at: Vec; w: number }[];
  minDistance?: number;
  maxStage: number;
}

function placeSpecs(): SpawnSpec[] {
  const anchor = (id: string, w: number) => {
    const place = PLACES.find((item) => item.id === id);
    return place ? { at: { x: place.x, y: place.y }, w } : { at: { x: 50, y: 50 }, w };
  };
  return [
    {
      kind: "tree",
      count: NODE_LIMITS.tree,
      anchors: [anchor("grove", 10), anchor("field", 1.5), anchor("porch", 1.5), anchor("well", 1), anchor("rise", 1)],
      minDistance: 3.2,
      maxStage: 3,
    },
    {
      kind: "rock",
      count: NODE_LIMITS.rock,
      anchors: [anchor("rise", 10), anchor("grove", 1.5), anchor("mill", 2), anchor("well", 1.5)],
      minDistance: 3.4,
      maxStage: 2,
    },
    {
      kind: "berry",
      count: NODE_LIMITS.berry,
      anchors: [anchor("grove", 5), anchor("field", 2), anchor("well", 2), anchor("mill", 2), anchor("rise", 2), anchor("square", 1.5), anchor("hearth", 1.5)],
      minDistance: 4,
      maxStage: 3,
    },
    {
      kind: "crop",
      count: NODE_LIMITS.crop,
      anchors: [anchor("field", 7), anchor("mill", 3), anchor("square", 2), anchor("rise", 2), anchor("hearth", 2)],
      minDistance: 3.6,
      maxStage: 3,
    },
  ];
}

function scatterOne(spec: SpawnSpec, taken: Vec[], rng: { rng: number }): Vec | null {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const total = spec.anchors.reduce((sum, item) => sum + item.w, 0);
    let pick = roll(rng) * total;
    let chosen = spec.anchors[0] ?? { at: { x: 50, y: 50 }, w: 1 };
    for (const anchorSpec of spec.anchors) {
      pick -= anchorSpec.w;
      if (pick <= 0) {
        chosen = anchorSpec;
        break;
      }
    }
    const angle = roll(rng) * Math.PI * 2;
    const radius = 2 + Math.pow(roll(rng), 1.7) * 9;
    const x = chosen.at.x + Math.cos(angle) * radius;
    const y = chosen.at.y + Math.sin(angle) * radius * 0.8;
    if (x < 4 || y < 6 || x > GRID_W - 4 || y > GRID_H - 6) continue;
    if (PLACES.some((place) => place.shelter && Math.hypot(place.x - x, place.y - y) < place.r - 1)) continue;
    const minDistance = spec.minDistance ?? 3;
    if (taken.some((other) => dist(other, { x, y }) < minDistance)) continue;
    return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}

export function scatterNodes(rng: { rng: number }): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  const taken: Vec[] = [];
  let serial = 0;
  for (const spec of placeSpecs()) {
    for (let index = 0; index < spec.count; index += 1) {
      const at = scatterOne(spec, taken, rng);
      if (!at) continue;
      taken.push(at);
      const startStage = spec.kind === "crop" ? 0 : spec.maxStage;
      nodes.push({
        id: `${spec.kind}-${serial}`,
        kind: spec.kind,
        x: at.x,
        y: at.y,
        stage: startStage,
        maxStage: spec.maxStage,
        growAt: null,
      });
      serial += 1;
    }
  }
  return nodes;
}

export function nodeById(nodes: ResourceNode[], id: string): ResourceNode | null {
  return nodes.find((node) => node.id === id) ?? null;
}

/** Yield of one work pass on a node, before carry limits. */
export function yieldOf(node: ResourceNode): { item: "wood" | "stone" | "berries" | "grain"; qty: number } | null {
  if (node.stage <= 0) return null;
  if (node.kind === "tree") return { item: "wood", qty: node.stage >= 3 ? 2 : 1 };
  if (node.kind === "rock") return { item: "stone", qty: node.stage >= 2 ? 2 : 1 };
  if (node.kind === "berry") return { item: "berries", qty: 4 };
  if (node.kind === "crop" && node.stage >= node.maxStage) return { item: "grain", qty: 4 };
  return null;
}

/** Apply one depletion pass; returns true when the node changed. */
export function deplete(node: ResourceNode): boolean {
  if (node.stage <= 0) return false;
  if (node.kind === "crop") {
    if (node.stage < node.maxStage) return false;
    node.stage = 0;
    return true;
  }
  node.stage -= 1;
  return true;
}

/**
 * Daily growth pass (called at 05:00). Trees and berries regrow by roll; a
 * bare crop plot only advances when someone plants it, but rain nudges
 * planted crops along during the day via cropGrowth().
 */
export function dailyGrowth(nodes: ResourceNode[], rng: { rng: number }, day: number): void {
  for (const node of nodes) {
    if (node.kind === "tree" && node.stage < node.maxStage && roll(rng) < 0.16) node.stage += 1;
    else if (node.kind === "berry" && node.stage < node.maxStage && roll(rng) < 0.6) node.stage += 1;
    else if (node.kind === "rock" && node.stage <= 0) tryRespawnRock(nodes, rng, day);
  }
}

/** Rocks do not regrow in place; a new one surfaces somewhere rocky. */
function tryRespawnRock(nodes: ResourceNode[], rng: { rng: number }, day: number): void {
  const rocks = nodes.filter((node) => node.kind === "rock");
  const live = rocks.filter((node) => node.stage > 0).length;
  if (live >= NODE_LIMITS.rock - 2 || roll(rng) >= 0.05) return;
  const taken = nodes.map((node) => ({ x: node.x, y: node.y }));
  const spec: SpawnSpec = {
    kind: "rock",
    count: 1,
    anchors: [
      { at: { x: 62, y: 78 }, w: 10 },
      { at: { x: 12, y: 42 }, w: 1.5 },
      { at: { x: 22, y: 22 }, w: 2 },
    ],
    minDistance: 3.4,
    maxStage: 2,
  };
  const at = scatterOne(spec, taken, rng);
  if (!at) return;
  rocks.push({
    id: `rock-r${day}-${rocks.length}`,
    kind: "rock",
    x: at.x,
    y: at.y,
    stage: 1,
    maxStage: 2,
    growAt: null,
  });
}

/** In-day crop growth check, weather-modulated. Called every 3 in-world hours. */
export function cropGrowth(nodes: ResourceNode[], rng: { rng: number }, weather: Weather): void {
  const chance = weather === "rain" ? 0.55 : weather === "storm" ? 0.15 : weather === "clear" ? 0.3 : 0.22;
  for (const node of nodes) {
    if (node.kind !== "crop") continue;
    if (node.stage <= 0 || node.stage >= node.maxStage) continue;
    if (weather === "storm" && roll(rng) < 0.2 && node.stage > 1) node.stage -= 1;
    else if (roll(rng) < chance) node.stage += 1;
  }
}
