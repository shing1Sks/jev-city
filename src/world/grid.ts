import { PLACES } from "./map.js";
import type { PlaceId, Terrain, Vec } from "./types.js";
import { GRID_H, GRID_W } from "./types.js";

/**
 * Static terrain: grass everywhere, soil at the field, roads along the given
 * place-to-place links. Roads are the ones the town starts with; nothing else
 * is given.
 */

function segmentCells(a: Vec, b: Vec, width: number, mark: (x: number, y: number) => void): void {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const cx = a.x + (b.x - a.x) * t;
    const cy = a.y + (b.y - a.y) * t;
    const reach = Math.ceil(width);
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dy = -reach; dy <= reach; dy += 1) {
        if (dx * dx + dy * dy <= width * width) mark(Math.round(cx + dx), Math.round(cy + dy));
      }
    }
  }
}

export function buildTerrain(): Terrain[] {
  const cells: Terrain[] = new Array(GRID_W * GRID_H).fill("grass");
  const mark = (terrain: Terrain) => (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= GRID_W - 1 || y >= GRID_H - 1) return;
    cells[y * GRID_W + x] = terrain;
  };
  const setSoil = mark("soil");
  const setRoad = mark("road");
  for (const place of PLACES) {
    if (place.id === "field") segmentCells({ x: place.x - 7, y: place.y - 5 }, { x: place.x + 7, y: place.y + 5 }, 5, setSoil);
  }
  for (const place of PLACES) {
    for (const next of place.neighbors) {
      const other = PLACES.find((item) => item.id === next);
      if (other && place.id < other.id) {
        segmentCells({ x: place.x, y: place.y }, { x: other.x, y: other.y }, 1.1, setRoad);
      }
    }
  }
  return cells;
}

/** Cells occupied by something solid (a standing tree, a rock). Crops and bushes are walkable. */
export type BlockMask = Uint8Array;

export function cellKey(x: number, y: number): number {
  return y * GRID_W + x;
}

export function buildBlockMask(nodes: { kind: string; x: number; y: number; stage: number }[]): BlockMask {
  const mask = new Uint8Array(GRID_W * GRID_H);
  for (const node of nodes) {
    if (node.stage <= 0) continue;
    if (node.kind === "crop" || node.kind === "berry") continue;
    const x = Math.round(node.x);
    const y = Math.round(node.y);
    if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) mask[cellKey(x, y)] = 1;
  }
  return mask;
}

export function terrainAt(terrain: Terrain[], x: number, y: number): Terrain {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= GRID_W || cy >= GRID_H) return "grass";
  return terrain[cy * GRID_W + cx] ?? "grass";
}

export function isRoad(terrain: Terrain[], at: Vec): boolean {
  return terrainAt(terrain, at.x, at.y) === "road";
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/**
 * A* over the grid. `blocked` holds dynamic obstacles. Roads cost less.
 * Returns smoothed waypoints in world units, or null when unreachable within
 * the expansion budget (caller falls back to a straight walk).
 */
export function findPath(
  terrain: Terrain[],
  blocked: BlockMask,
  from: Vec,
  to: Vec,
  budget = 24000,
): Vec[] | null {
  const start = { x: clampCell(Math.floor(from.x)), y: clampCell(Math.floor(from.y)) };
  const goal = { x: clampCell(Math.floor(to.x)), y: clampCell(Math.floor(to.y)) };
  const startIndex = cellKey(start.x, start.y);
  const goalIndex = cellKey(goal.x, goal.y);
  if (blocked[startIndex] === 1 || blocked[goalIndex] === 1) return null;

  const open: number[] = [startIndex];
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[startIndex, 0]]);
  const fScore = new Map<number, number>([[startIndex, octile(start, goal)]]);
  let expansions = 0;

  while (open.length > 0 && expansions < budget) {
    let bestSlot = 0;
    let bestScore = Infinity;
    for (let slot = 0; slot < open.length; slot += 1) {
      const score = fScore.get(open[slot] ?? 0) ?? Infinity;
      if (score < bestScore) {
        bestScore = score;
        bestSlot = slot;
      }
    }
    const current = open.splice(bestSlot, 1)[0];
    if (current === goalIndex) {
      const raw = reconstruct(cameFrom, current).map((cell) => ({
        x: (cell % GRID_W) + 0.5,
        y: Math.floor(cell / GRID_W) + 0.5,
      }));
      raw.push({ x: to.x, y: to.y });
      return smooth(raw, blocked);
    }
    expansions += 1;
    const cx = current % GRID_W;
    const cy = Math.floor(current / GRID_W);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny) || blocked[cellKey(nx, ny)] === 1) continue;
      if (dx !== 0 && dy !== 0 && (blocked[cellKey(cx + dx, cy)] === 1 || blocked[cellKey(cx, cy + dy)] === 1)) continue;
      const stepCost = cost * (terrain[cellKey(nx, ny)] === "road" ? 0.72 : 1);
      const next = cellKey(nx, ny);
      const tentative = (gScore.get(current) ?? Infinity) + stepCost;
      if (tentative < (gScore.get(next) ?? Infinity)) {
        cameFrom.set(next, current);
        gScore.set(next, tentative);
        fScore.set(next, tentative + octile({ x: nx, y: ny }, goal));
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<number, number>, current: number): number[] {
  const cells: number[] = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current) ?? current;
    cells.push(current);
  }
  cells.reverse();
  return cells;
}

/** Drop waypoints reachable in a straight unblocked line (string pulling). */
function smooth(path: Vec[], blocked: BlockMask): Vec[] {
  if (path.length <= 2) return path;
  const out: Vec[] = [path[0] ?? { x: 0, y: 0 }];
  let anchor = 0;
  for (let probe = 2; probe < path.length; probe += 1) {
    if (!lineClear(path[anchor] ?? path[0], path[probe], blocked)) {
      out.push(path[probe - 1] ?? path[probe]);
      anchor = probe - 1;
    }
  }
  out.push(path[path.length - 1] ?? { x: 0, y: 0 });
  return out;
}

function lineClear(a: Vec, b: Vec, blocked: BlockMask): boolean {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const x = Math.floor(a.x + (b.x - a.x) * t);
    const y = Math.floor(a.y + (b.y - a.y) * t);
    if (!inBounds(x, y) || blocked[cellKey(x, y)] === 1) return false;
  }
  return true;
}

function octile(a: Vec, b: Vec): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
}

function clampCell(value: number): number {
  return Math.max(0, Math.min(GRID_W - 1, value));
}

/** Nearest passable cell to a point, for goals that sit inside an obstacle. */
export function nearestOpen(blocked: BlockMask, at: Vec, ring = 6): Vec {
  const x0 = Math.floor(at.x);
  const y0 = Math.floor(at.y);
  if (inBounds(x0, y0) && blocked[cellKey(x0, y0)] === 0) return { x: x0 + 0.5, y: y0 + 0.5 };
  for (let r = 1; r <= ring; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dy = -r; dy <= r; dy += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx;
        const y = y0 + dy;
        if (inBounds(x, y) && blocked[cellKey(x, y)] === 0) return { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return { x: x0 + 0.5, y: y0 + 0.5 };
}

/** The named region whose circle contains the point, or the nearest one within `margin`. */
export function regionAt(at: Vec, margin = 4): PlaceId | null {
  let best: PlaceId | null = null;
  let bestDistance = Infinity;
  for (const place of PLACES) {
    const distance = Math.hypot(place.x - at.x, place.y - at.y);
    if (distance <= place.r + margin && distance < bestDistance) {
      best = place.id;
      bestDistance = distance;
    }
  }
  return best;
}
