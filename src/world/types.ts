export const SKILLS = ["farm", "cook", "mend", "forage", "haul", "heal", "teach", "play"] as const;
export type Skill = (typeof SKILLS)[number];

export type Band = "toddler" | "child" | "youth" | "adult" | "elder";
export type Gender = "male" | "female";
export type Phase = "night" | "dawn" | "day" | "dusk";
export type Weather = "clear" | "cloudy" | "rain" | "wind";
export type Audience = "private" | "here" | "town";
export type Custom = "provision" | "keep" | "learn" | "counsel";

export type PlaceId =
  | "grove"
  | "field"
  | "well"
  | "vale"
  | "square"
  | "hearth"
  | "market"
  | "porch";

export type ActionKind =
  | "stay"
  | "go"
  | "eat"
  | "rest"
  | "sleep"
  | "farm"
  | "cook"
  | "mend"
  | "forage"
  | "haul"
  | "heal"
  | "teach"
  | "learn"
  | "play"
  | "care"
  | "watch"
  | "speak";

export interface Place {
  id: PlaceId;
  name: string;
  x: number;
  y: number;
  shelter: boolean;
  neighbors: PlaceId[];
}

export type ProjectKind = "orchard" | "garden" | "stall" | "shrine" | "watch";

export interface Ambition {
  independence: string;
  love: string;
  passion: string;
  likes: string;
  dislikes: string;
  career: string;
  plan: string;
  project: ProjectKind;
}

export interface Self {
  temper: string;
  want: string;
  fear: string;
  habit: string;
  pull: ActionKind[];
  custom: Custom;
  ambition: Ambition;
}

export interface ActionOption {
  id: string;
  kind: ActionKind;
  place: PlaceId | null;
  label: string;
  detail: string;
  escort: boolean;
}

export interface Utterance {
  intentWord: string;
  topic: string;
  tone: string;
  text: string;
}

export interface ActiveIntent {
  actionId: string;
  kind: ActionKind;
  place: PlaceId | null;
  path: PlaceId[];
  wait: number;
  escort: boolean;
}

export const HOP_TICKS = 4;

export type Facing = "front" | "back" | "left" | "right";

export type Feeling = "content" | "hungry" | "tired" | "lonely" | "afraid" | "playing";

export interface Walk {
  from: PlaceId;
  to: PlaceId;
  t: number;
}

export interface SpeechBubble {
  text: string;
  audience: Audience;
  listenerId: string | null;
  ticks: number;
}

export interface MemoryLine {
  clock: string;
  text: string;
  private: boolean;
}

export interface Person {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  band: Band;
  household: string;
  home: PlaceId;
  spouse: string | null;
  guardians: string[];
  dependents: string[];
  self: Self;
  skills: Record<Skill, number>;
  place: PlaceId;
  x: number;
  y: number;
  facing: Facing;
  hunger: number;
  energy: number;
  belonging: number;
  distress: boolean;
  choresToday: number;
  projectProgress: number;
  intent: ActiveIntent | null;
  speech: SpeechBubble | null;
  memory: MemoryLine[];
  mood: string;
  innerNote: string;
  because: string;
}

export interface Bond {
  a: string;
  b: string;
  score: number;
  note: string;
}

export interface CityEvent {
  id: number;
  tick: number;
  clock: string;
  kind: "speech" | "work" | "law" | "weather" | "meal" | "move";
  speakerId: string | null;
  audience: Audience | null;
  listenerId: string | null;
  place: PlaceId | null;
  text: string;
  heardBy: string[];
}

export interface Decision {
  personId: string;
  actionId: string;
  speak: boolean;
  audience: Audience;
  listenerId: string | null;
  intentWord: string;
  topic: string;
  tone: string;
  because: string;
  source: "jev" | "reflex" | "law";
  confidence: number | null;
}

export interface SoulStatus {
  mode: "jev" | "reflex";
  configured: boolean;
  lastError: string | null;
  lastModel: string | null;
  inFlight: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

export interface GeminiStatus {
  configured: boolean;
  status: "off" | "ready" | "working" | "error";
  lastError: string | null;
  calls: number;
  model: string;
}

export interface World {
  tick: number;
  hour: number;
  minute: number;
  phase: Phase;
  weather: Weather;
  food: Record<string, number>;
  people: Person[];
  bonds: Bond[];
  log: CityEvent[];
  nextEventId: number;
  chronicle: string;
  chronicleAt: string | null;
  story: TownStory;
  expansions: Expansion[];
  uncompiled: number;
  soul: SoulStatus;
  gemini: GeminiStatus;
}

export interface PublicPerson {
  id: string;
  name: string;
  age: number;
  gender: Gender;
  band: Band;
  household: string;
  home: PlaceId;
  spouse: string | null;
  guardians: string[];
  dependents: string[];
  place: PlaceId;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  feeling: Feeling;
  hunger: number;
  energy: number;
  belonging: number;
  distress: boolean;
  mood: string;
  innerNote: string;
  because: string;
  doing: string;
  thinking: boolean;
  walk: Walk | null;
  ledBy: string | null;
  self: Self;
  skills: Record<Skill, number>;
  speech: SpeechBubble | null;
  memory: MemoryLine[];
}

export interface Expansion {
  id: string;
  ownerId: string;
  kind: ProjectKind;
  label: string;
  x: number;
  y: number;
}

export interface TownStory {
  headline: string;
  body: string;
  gossip: string[];
  at: string | null;
}

export interface PublicState {
  tick: number;
  hour: number;
  minute: number;
  clock: string;
  phase: Phase;
  weather: Weather;
  food: Record<string, number>;
  people: PublicPerson[];
  bonds: Bond[];
  log: CityEvent[];
  chronicle: string;
  chronicleAt: string | null;
  story: TownStory;
  expansions: Expansion[];
  soul: SoulStatus;
  gemini: GeminiStatus;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function bondKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export function clockLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function phaseOf(hour: number): Phase {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 17) return "day";
  if (hour >= 17 && hour < 19) return "dusk";
  return "night";
}

export function bandFor(age: number): Band {
  if (age <= 4) return "toddler";
  if (age <= 12) return "child";
  if (age <= 17) return "youth";
  if (age <= 59) return "adult";
  return "elder";
}
