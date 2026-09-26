export const SKILLS = ["farm", "cook", "mend", "forage", "haul", "heal", "teach", "play"] as const;
export type Skill = (typeof SKILLS)[number];

export type Band = "toddler" | "child" | "youth" | "adult" | "elder";
export type Gender = "male" | "female";
export type Phase = "night" | "dawn" | "day" | "dusk";
export type Weather = "clear" | "cloudy" | "rain" | "wind" | "storm";
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
  | "porch"
  | "mill"
  | "rise";

export interface Vec {
  x: number;
  y: number;
}

/** One grid cell is one world unit; the render maps 0..100 to the stage. */
export const GRID_W = 100;
export const GRID_H = 100;

export interface Place {
  id: PlaceId;
  name: string;
  x: number;
  y: number;
  /** Region radius in world units. */
  r: number;
  shelter: boolean;
  neighbors: PlaceId[];
}

export type Terrain = "grass" | "road" | "soil";

/** One in-world minute per tick; a day is 1440 ticks (24 real minutes at 1x). */
export const MINUTES_PER_TICK = 1;

// ---------------------------------------------------------------- resources

export type Item = "wood" | "stone" | "grain" | "berries" | "cloth";
export const ITEMS: Item[] = ["wood", "stone", "grain", "berries", "cloth"];

export type Carry = Partial<Record<Item, number>>;
export type Storage = Record<Item, number>;

/** How many item units a band can carry at once. */
export function carryCapacity(band: Band): number {
  if (band === "toddler") return 0;
  if (band === "child") return 2;
  if (band === "youth") return 3;
  if (band === "elder") return 3;
  return 4;
}

export function carryCount(carry: Carry): number {
  return Object.values(carry).reduce((sum, count) => sum + (count ?? 0), 0);
}

export type NodeKind = "tree" | "rock" | "berry" | "crop";

export interface ResourceNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** 0 is depleted (stump, rubble, bare); maxStage is full or ripe. */
  stage: number;
  maxStage: number;
  /** Tick when the next growth roll happens, or null. */
  growAt: number | null;
}

// ---------------------------------------------------------------- building

export type ProjectKind = "orchard" | "garden" | "stall" | "shrine" | "watch" | "house";

export interface BuildSite {
  id: string;
  ownerId: string;
  kind: ProjectKind;
  label: string;
  x: number;
  y: number;
  /** Materials still owed to the site. */
  need: Carry;
  /** Materials already lying at the site. */
  have: Carry;
  /** 0 marked, 1..N construction stages, done sites become buildings. */
  stage: number;
  stages: number;
}

// ---------------------------------------------------------------- steps

export type StepKind =
  | "walk"
  | "chop"
  | "mine"
  | "harvest"
  | "plant"
  | "store"
  | "withdraw"
  | "build"
  | "eat"
  | "sleep"
  | "rest"
  | "play"
  | "care"
  | "teach"
  | "learn"
  | "express"
  | "give";

export interface StepOption {
  id: string;
  kind: StepKind;
  label: string;
  detail: string;
  nodeId?: string;
  siteId?: string;
  toId?: string;
  place?: PlaceId;
  dest?: Vec;
  leadId?: string;
}

export interface ActiveStep {
  kind: StepKind;
  note: string;
  nodeId?: string;
  siteId?: string;
  toId?: string;
  dest?: Vec;
  path?: Vec[];
  remaining?: number;
  /** Toddler being led by the hand. */
  leadId?: string;
  /** The step to run once this one finishes (walk to node, then work it). */
  then?: ActiveStep;
}

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

/** Kept from V1 so seeds and the lexicon stamps still typecheck; the spine replaces acts with steps. */
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
  | "build"
  | "speak";

export interface Utterance {
  intentWord: string;
  topic: string;
  tone: string;
  text: string;
}

export type Facing = "front" | "back" | "left" | "right";

export type Feeling = "content" | "hungry" | "tired" | "lonely" | "afraid" | "playing" | "jealous" | "bitter" | "rival";

export type MatterKind = "court" | "rift" | "teach" | "rival";

export interface Matter {
  withId: string;
  kind: MatterKind;
  step: number;
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
  /** Who the line is about (person id), when code knows it. */
  about?: string;
  /** +1 kindness, -1 slight, 0/undefined neutral — set where the act is typed. */
  polarity?: number;
  /** How much it matters, roughly 1-40; eviction and recall rank on this. */
  salience?: number;
  /** The tick it was laid down; fade and recall use it. */
  at?: number;
}

/** Episodes slept into one standing line — a ledger entry, not prose. */
export interface PersonBelief {
  text: string;
  at: number;
  about: string;
  polarity: number;
  count: number;
}

/** What the spine last committed to: a task label and the steps taken so far. */
export interface PersonTask {
  label: string;
  chosen: string[];
  startedTick: number;
}

/** A favor accepted through Luna dialogue: carry the goods, hand them over. */
export interface OwedFavor {
  toId: string;
  item: Item;
  qty: number;
  /** When the promise was made; favors past two days fade unkept. */
  at?: number;
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
  authority: number;
  bricks: number;
  alive: boolean;
  matter: Matter | null;
  settledWith: string[];
  step: ActiveStep | null;
  task: PersonTask | null;
  /** Luna-accepted request awaiting hand-over; optional so old saves load clean. */
  owe?: OwedFavor | null;
  /** Luna-invited pull toward a place until a tick; optional, transient by nature. */
  invite?: { place: PlaceId; untilTick: number } | null;
  /** Illness: confined to home and rest until comforted or two days pass. */
  ill?: { since: number } | null;
  carry: Carry;
  speech: SpeechBubble | null;
  memory: MemoryLine[];
  beliefs?: PersonBelief[];
  mood: string;
  innerNote: string;
  because: string;
}

export interface Bond {
  a: string;
  b: string;
  score: number;
  note: string;
  love: number;
  jealousy: number;
  hate: number;
  rivalry: number;
}

// ---------------------------------------------------------------- animals

export type AnimalKind = "crow" | "deer" | "dog";

export type AnimalMove = "wander" | "graze" | "steal" | "flee" | "follow" | "rest";

export interface AnimalStep {
  kind: AnimalMove;
  dest: Vec | null;
  /** The berry bush a crow means to pick. */
  nodeId?: string;
  /** Who the dog is trailing. */
  personId?: string;
  untilTick: number;
}

/** A wild body on the grid: instincts in code, urges optionally from laya. */
export interface Animal {
  id: string;
  kind: AnimalKind;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  fear: number;
  hunger: number;
  step: AnimalStep | null;
  /** An urge the laya mind laid down, honored while it stands; instincts ignore invalid ones. */
  bias?: { kind: AnimalMove; untilTick: number } | null;
}

/** Telemetry for the laya animal mind, mirroring the other chips. */
export interface BeastStatus {
  configured: boolean;
  status: "off" | "ready" | "working" | "error";
  lastError: string | null;
  calls: number;
}

export interface CityEvent {
  id: number;
  tick: number;
  clock: string;
  kind: "speech" | "work" | "law" | "weather" | "meal" | "move" | "build" | "life";
  speakerId: string | null;
  audience: Audience | null;
  listenerId: string | null;
  place: PlaceId | null;
  text: string;
  heardBy: string[];
}

export interface Decision {
  personId: string;
  stepId: string;
  speak: boolean;
  audience: Audience;
  listenerId: string | null;
  intentWord: string;
  topic: string;
  tone: string;
  because: string;
  /** Spine only: keep the person's current task, optionally relabel it. */
  task?: { keep: boolean; label?: string };
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
  /** Optional so pre-spine saves load clean; the spine accrues both. */
  costUsd?: number;
  tokensThisHour?: number;
}

/** Luna telemetry, mirroring the spine's soul counters. */
export interface BrainStatus {
  configured: boolean;
  status: "off" | "ready" | "working" | "error";
  lastError: string | null;
  lastModel: string | null;
  inFlight: boolean;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  callsThisHour: number;
}

/** Typed acts are what make Luna's words causal; code executes the effect. */
export type DialogueAct =
  | { kind: "request"; item: Item; qty: number }
  | { kind: "give"; item: Item; qty: number }
  | { kind: "invite"; place: PlaceId }
  | { kind: "warn" }
  | { kind: "comfort" }
  | { kind: "thank" }
  | { kind: "tease" };

/** One queued Luna line, delivered the next time speaker and listener share air. */
export interface PendingDialogue {
  fromId: string;
  /** A person id, or "town" for a square announcement. */
  toId: string | "town";
  act: DialogueAct;
  line: string;
  expires: number;
}

/** Story telemetry — Luna narrates the town for visitors; she never chooses a resident's act. */
export interface LunaStatus {
  configured: boolean;
  status: "off" | "ready" | "working" | "error";
  lastError: string | null;
  calls: number;
  model: string;
}

export interface TownVisitor {
  id: string;
  name: string;
  ipHash: string;
  place: PlaceId;
  x: number;
  y: number;
  facing: Facing;
  dest: PlaceId | null;
  speech: { text: string; ticks: number } | null;
  note: string;
}

export interface VisitorMark {
  id: string;
  name: string;
  place: PlaceId;
  x: number;
  y: number;
  facing: Facing;
  speech: { text: string; ticks: number } | null;
  note: string;
}

export interface World {
  schema: 2;
  tick: number;
  hour: number;
  minute: number;
  phase: Phase;
  weather: Weather;
  day: number;
  solMinutes: number;
  needsSummary: boolean;
  summaryFor: number | null;
  /** Deterministic world RNG state; persisted so fortune continues across restarts. */
  rng: number;
  storages: Record<string, Storage>;
  people: Person[];
  bonds: Bond[];
  nodes: ResourceNode[];
  sites: BuildSite[];
  animals: Animal[];
  beast: BeastStatus;
  log: CityEvent[];
  nextEventId: number;
  chronicle: string;
  chronicleAt: string | null;
  story: TownStory;
  expansions: Expansion[];
  visitors: TownVisitor[];
  visitorLog: string[];
  uncompiled: number;
  soul: SoulStatus;
  luna: LunaStatus;
  brain: BrainStatus;
  /** Newborns awaiting a Luna name; the formula name stands until one lands. */
  pendingNames: string[];
  /** Luna lines in flight, delivered on co-location, dropped when they expire. */
  dialogue: PendingDialogue[];
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
  authority: number;
  bricks: number;
  alive: boolean;
  matter: { withName: string; kind: MatterKind; step: number } | null;
  task: PersonTask | null;
  hunger: number;
  energy: number;
  belonging: number;
  distress: boolean;
  mood: string;
  innerNote: string;
  because: string;
  doing: string;
  thinking: boolean;
  carry: Carry;
  ledBy: string | null;
  self: Self;
  skills: Record<Skill, number>;
  speech: SpeechBubble | null;
  memory: MemoryLine[];
  beliefs?: PersonBelief[];
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
  day: number | null;
}

export interface PublicState {
  tick: number;
  hour: number;
  minute: number;
  clock: string;
  phase: Phase;
  weather: Weather;
  day: number;
  storages: Record<string, Storage>;
  people: PublicPerson[];
  bonds: Bond[];
  nodes: ResourceNode[];
  sites: BuildSite[];
  animals: Animal[];
  beast: BeastStatus;
  log: CityEvent[];
  chronicle: string;
  chronicleAt: string | null;
  story: TownStory;
  expansions: Expansion[];
  visitors: VisitorMark[];
  visitorLog: string[];
  soul: SoulStatus;
  luna: LunaStatus;
  brain: BrainStatus;
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

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Deterministic 32-bit RNG (mulberry32). Returns [0,1) and mutates world.rng. */
export function roll(world: { rng: number }): number {
  world.rng = (world.rng + 0x6d2b79f5) | 0;
  let t = world.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
