import type { Place, PlaceId, Vec } from "./types.js";

/**
 * Named regions of the town. They are labels, meeting points, and homes —
 * movement is free across the grid; nothing teleports between places.
 */
export const PLACES: Place[] = [
  { id: "grove", name: "Grove", x: 12, y: 42, r: 8, shelter: false, neighbors: ["field", "mill"] },
  { id: "mill", name: "Mill", x: 22, y: 22, r: 6, shelter: true, neighbors: ["grove", "field", "vale"] },
  { id: "field", name: "Field", x: 34, y: 48, r: 8, shelter: false, neighbors: ["grove", "mill", "vale", "well"] },
  { id: "well", name: "Well", x: 24, y: 70, r: 5, shelter: false, neighbors: ["field", "square", "rise"] },
  { id: "vale", name: "Vale cottage", x: 44, y: 28, r: 6, shelter: true, neighbors: ["field", "mill", "square"] },
  { id: "square", name: "Square", x: 52, y: 56, r: 8, shelter: false, neighbors: ["vale", "well", "hearth", "market", "rise"] },
  { id: "hearth", name: "Hearth", x: 68, y: 24, r: 6, shelter: true, neighbors: ["square", "porch"] },
  { id: "market", name: "Market loft", x: 74, y: 62, r: 6, shelter: true, neighbors: ["square", "porch", "rise"] },
  { id: "rise", name: "Rise", x: 62, y: 78, r: 8, shelter: false, neighbors: ["square", "well", "market"] },
  { id: "porch", name: "Elder porch", x: 88, y: 40, r: 6, shelter: true, neighbors: ["hearth", "market"] },
];

export type PlaceWithRadius = Place & { r: number };

const BY_ID = new Map<string, Place & { r: number }>(PLACES.map((place) => [place.id, place as PlaceWithRadius]));

export function placeOf(id: PlaceId): Place & { r: number } {
  const place = BY_ID.get(id);
  if (!place) throw new Error(`Unknown place ${id}`);
  return place;
}

export function centerOf(id: PlaceId): Vec {
  const place = placeOf(id);
  return { x: place.x, y: place.y };
}

/** Legacy hop distance, kept for guardian-duty ranking; now grid-based in spirit. */
export function pathLength(from: PlaceId, to: PlaceId): number {
  if (from === to) return 0;
  const queue: PlaceId[] = [from];
  const seen = new Set<PlaceId>([from]);
  let hops = 0;
  while (queue.length > 0) {
    hops += 1;
    const size = queue.length;
    for (let index = 0; index < size; index += 1) {
      const current = queue.shift();
      if (!current) break;
      for (const next of placeOf(current).neighbors) {
        if (next === to) return hops;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return hops;
}
