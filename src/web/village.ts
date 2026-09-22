import { PLACES } from "../world/map.js";
import type { PlaceId } from "../world/types.js";

export const SPOTS: Record<PlaceId, { x: number; y: number }> = Object.fromEntries(
  PLACES.map((place) => [place.id, { x: place.x, y: place.y }]),
) as Record<PlaceId, { x: number; y: number }>;

export const ROUTES: [PlaceId, PlaceId][] = [
  ["grove", "field"],
  ["grove", "mill"],
  ["mill", "field"],
  ["mill", "vale"],
  ["field", "vale"],
  ["field", "well"],
  ["well", "square"],
  ["well", "rise"],
  ["vale", "square"],
  ["square", "hearth"],
  ["square", "market"],
  ["square", "rise"],
  ["hearth", "porch"],
  ["market", "porch"],
  ["market", "rise"],
];

export interface Prop {
  src: string;
  x: number;
  y: number;
  w: number;
}

const treeLine = (y: number, start: number): Prop[] =>
  Array.from({ length: 8 }, (_, index) => ({
    src: `/craft/summer/${encodeURIComponent(index % 2 === 0 ? "Prop - Tree Small.png" : "Prop - Tree Medium.png")}`,
    x: start + index * 11,
    y,
    w: index % 2 === 0 ? 4.2 : 5.4,
  }));

export const PROPS: Prop[] = [
  ...treeLine(6, 8),
  ...treeLine(94, 6),
  { src: "/craft/summer/prop%20-%20Tree%20Large.png", x: 8, y: 28, w: 7 },
  { src: "/craft/summer/Prop%20-%20Tree%20Medium.png", x: 18, y: 22, w: 5.5 },
  { src: "/craft/summer/Prop%20-%20Tree%20Small.png", x: 10, y: 52, w: 4 },
  { src: "/craft/summer/Prop%20-%20Tree%20Medium.png", x: 20, y: 48, w: 5 },
  { src: "/craft/summer/Prop%20-%20Tree%20Small.png", x: 6, y: 64, w: 3.6 },
  { src: "/craft/summer/Prop%20-%20Bushes%20Large.png", x: 24, y: 34, w: 5 },
  { src: "/craft/summer/Prop%20-%20Bushes%20Medium.png", x: 38, y: 46, w: 4 },
  { src: "/craft/summer/Prop%20-%20Bushes%20Small.png", x: 58, y: 48, w: 3.2 },
  { src: "/craft/summer/Prop%20-%20House.png", x: 44, y: 14, w: 8 },
  { src: "/craft/summer/Prop%20-%20House.png", x: 74, y: 56, w: 7.5 },
  { src: "/craft/summer/Prop%20-%20Campfire.png", x: 66, y: 22, w: 3.4 },
  { src: "/craft/summer/Prop%20-%20Well.png", x: 20, y: 68, w: 3.6 },
  { src: "/craft/summer/Prop%20-%20Windmill.png", x: 20, y: 16, w: 6 },
  { src: "/craft/summer/Prop%20-%20House.png", x: 60, y: 74, w: 6 },
  { src: "/craft/summer/Prop%20-%20Castle%20Square.png", x: 88, y: 28, w: 7 },
  { src: "/craft/summer/Prop%20-%20Watchtower%20Short.png", x: 30, y: 18, w: 4 },
  { src: "/craft/summer/Prop%20-%20Wooden%20Cart.png", x: 68, y: 64, w: 4.5 },
  { src: "/craft/summer/Prop%20-%20Wooden%20Barrel.png", x: 80, y: 62, w: 2.2 },
  { src: "/craft/summer/Prop%20-%20Tent.png", x: 80, y: 18, w: 4.2 },
  { src: "/craft/summer/Prop%20-%20Wooden%20Fence%20Horizontal.png", x: 36, y: 40, w: 6 },
  { src: "/craft/summer/Prop%20-%20Wooden%20Fence%20Horizontal.png", x: 36, y: 62, w: 6 },
  { src: "/craft/summer/Prop%20-%20Flag.png", x: 54, y: 50, w: 2 },
  { src: "/craft/rocks/rock-1.png", x: 16, y: 80, w: 2.2 },
  { src: "/craft/rocks/rock-2.png", x: 26, y: 84, w: 1.8 },
  { src: "/craft/rocks/rock-3.png", x: 62, y: 78, w: 1.6 },
  { src: "/craft/rocks/rock-4.png", x: 90, y: 74, w: 2 },
  { src: "/craft/rocks/rock-5.png", x: 8, y: 78, w: 1.7 },
];

export type Look =
  | { pack: "goblin"; who: "male" | "female" | "chief"; hue: number }
  | { pack: "boss"; who: "shaman" | "devil" }
  | { pack: "valkyrie" };

export const LOOKS: Record<string, Look> = {
  jevaary: { pack: "goblin", who: "male", hue: 0 },
  jevine: { pack: "goblin", who: "female", hue: 0 },
  jevlin: { pack: "goblin", who: "male", hue: 28 },
  jevora: { pack: "goblin", who: "female", hue: 310 },
  jevoric: { pack: "boss", who: "shaman" },
  jevina: { pack: "valkyrie" },
  jevon: { pack: "goblin", who: "male", hue: 55 },
  jevara: { pack: "goblin", who: "female", hue: 190 },
  jevik: { pack: "goblin", who: "male", hue: 95 },
  jevella: { pack: "boss", who: "devil" },
};

export function bodyScale(band: string): number {
  if (band === "toddler") return 0.62;
  if (band === "child") return 0.78;
  if (band === "youth") return 0.9;
  if (band === "elder") return 0.96;
  return 1;
}

export const FEEL: Record<string, string> = {
  hungry: "hungry",
  tired: "tired",
  lonely: "lonely",
  afraid: "afraid",
  playing: "playing",
  content: "settled",
  jealous: "jealous",
  bitter: "bitter",
  rival: "competing",
};
