import type { Place, PlaceId } from "./types.js";

export const PLACES: Place[] = [
  { id: "grove", name: "Grove", x: 14, y: 38, shelter: false, neighbors: ["field"] },
  { id: "field", name: "Field", x: 32, y: 52, shelter: false, neighbors: ["grove", "vale", "well"] },
  { id: "well", name: "Well", x: 22, y: 74, shelter: false, neighbors: ["field", "square"] },
  { id: "vale", name: "Vale cottage", x: 46, y: 24, shelter: true, neighbors: ["field", "square"] },
  { id: "square", name: "Square", x: 52, y: 58, shelter: false, neighbors: ["vale", "well", "hearth", "market"] },
  { id: "hearth", name: "Hearth", x: 70, y: 26, shelter: true, neighbors: ["square", "porch"] },
  { id: "market", name: "Market loft", x: 76, y: 70, shelter: true, neighbors: ["square", "porch"] },
  { id: "porch", name: "Elder porch", x: 88, y: 44, shelter: true, neighbors: ["hearth", "market"] },
];

const BY_ID = new Map(PLACES.map((place) => [place.id, place]));

export function placeOf(id: PlaceId): Place {
  const place = BY_ID.get(id);
  if (!place) throw new Error(`Unknown place ${id}`);
  return place;
}

export function pathTo(from: PlaceId, to: PlaceId): PlaceId[] {
  if (from === to) return [];
  const queue: PlaceId[] = [from];
  const previous = new Map<PlaceId, PlaceId | null>([[from, null]]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const next of placeOf(current).neighbors) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path: PlaceId[] = [];
        let cursor: PlaceId | null = to;
        while (cursor && cursor !== from) {
          path.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

export function pathLength(from: PlaceId, to: PlaceId): number {
  return pathTo(from, to).length;
}
