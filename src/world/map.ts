import type { Place, PlaceId } from "./types.js";

export const PLACES: Place[] = [
  { id: "grove", name: "Grove", x: 12, y: 42, shelter: false, neighbors: ["field", "mill"] },
  { id: "mill", name: "Mill", x: 22, y: 22, shelter: true, neighbors: ["grove", "field", "vale"] },
  { id: "field", name: "Field", x: 34, y: 48, shelter: false, neighbors: ["grove", "mill", "vale", "well"] },
  { id: "well", name: "Well", x: 24, y: 70, shelter: false, neighbors: ["field", "square", "rise"] },
  { id: "vale", name: "Vale cottage", x: 44, y: 28, shelter: true, neighbors: ["field", "mill", "square"] },
  { id: "square", name: "Square", x: 52, y: 56, shelter: false, neighbors: ["vale", "well", "hearth", "market", "rise"] },
  { id: "hearth", name: "Hearth", x: 68, y: 24, shelter: true, neighbors: ["square", "porch"] },
  { id: "market", name: "Market loft", x: 74, y: 62, shelter: true, neighbors: ["square", "porch", "rise"] },
  { id: "rise", name: "Rise", x: 62, y: 78, shelter: false, neighbors: ["square", "well", "market"] },
  { id: "porch", name: "Elder porch", x: 88, y: 40, shelter: true, neighbors: ["hearth", "market"] },
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
