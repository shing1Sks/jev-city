import { canMarkSite, markSite } from "../world/construction.js";
import { centerOf } from "../world/map.js";
import { recallFor } from "../world/memory.js";
import { rosterFromEvents, salientEvents } from "../world/salience.js";
import { queueDialogue, townCeremony } from "../world/sim.js";
import type { DialogueAct, Item, Person, ProjectKind, World } from "../world/types.js";
import { carryCapacity, clamp, clockLabel } from "../world/types.js";
import { ITEMS } from "../world/types.js";

/**
 * Luna, the brain. One call every few minutes covers the agents who need
 * direction: a task, an inner thought, a keepable memory, spoken lines with
 * typed acts, and names for newborns. Luna never picks steps — that is the
 * spine's question — and never moves goods: acts are executed by code after
 * the spine walks the walk. Temperature sits at max on purpose; the immutable
 * identity block in each agent's section is the drift anchor.
 */

export interface LunaConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** US dollars per million input tokens, for the running-cost estimate. */
  priceIn: number;
  /** US dollars per million output tokens. */
  priceOut: number;
  /** Input+output tokens per rolling hour before the valve drops to fallback; 0 disables. */
  tokenCap: number;
  /** Brain calls per rolling hour before the valve drops to fallback. */
  callCap: number;
}

function numEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function brainConfigFromEnv(): LunaConfig | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.STORY_MODEL ?? "gpt-6-luna",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    priceIn: numEnv("LUNA_PRICE_IN", 0.1),
    priceOut: numEnv("LUNA_PRICE_OUT", 0.5),
    tokenCap: numEnv("LUNA_HOURLY_TOKEN_CAP", 600_000),
    callCap: numEnv("LUNA_HOURLY_CALLS", 60),
  };
}

// Rolling one-hour window in server memory, same shape as the spine's valve.
const budget = { hourStart: 0, calls: 0, tokens: 0 };

/** Test hook: start the hourly window fresh. */
export function resetLunaBudget(): void {
  budget.hourStart = 0;
  budget.calls = 0;
  budget.tokens = 0;
}

export interface LunaRequest {
  config: LunaConfig;
  system: string;
  user: string;
}

export interface LunaReply {
  text: string;
  usage: { input: number; output: number };
}

export type PostLuna = (request: LunaRequest) => Promise<LunaReply>;

/** Tasks older than this are stale and earn their agent a brain tick. */
const STALE_TICKS = 150;
const ROSTER_CAP = 8;

/**
 * Who needs direction: people a notable event just touched, then the agents
 * with no task or a stale one, oldest first. Toddlers stay on the brainstem.
 */
export function brainRoster(world: World, sinceTick: number): string[] {
  const roster: string[] = [];
  const eligible = (person: Person): boolean => person.alive && person.band !== "toddler";
  for (const id of rosterFromEvents(world, sinceTick)) {
    const person = world.people.find((item) => item.id === id);
    if (person && eligible(person) && !roster.includes(id)) roster.push(id);
  }
  const stale = world.people
    .filter((person) => eligible(person) && !roster.includes(person.id))
    .filter((person) => !person.task || world.tick - person.task.startedTick > STALE_TICKS)
    .sort((left, right) => (left.task?.startedTick ?? 0) - (right.task?.startedTick ?? 0));
  for (const person of stale) roster.push(person.id);
  return roster.slice(0, ROSTER_CAP);
}

// ---------------------------------------------------------------- prompt

function line(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function personBlock(world: World, person: Person): string {
  const near = world.people.filter(
    (other) => other.alive && other.id !== person.id && Math.hypot(other.x - person.x, other.y - person.y) <= 3.5,
  );
  const here = near.map((other) => other.name);
  const memory = recallFor(world, person, { nearby: near.map((other) => other.id), task: person.task?.label }).map(
    (item) => `- ${line(item.text)}`,
  );
  const bonds = world.bonds
    .filter((bond) => bond.a === person.id || bond.b === person.id)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((bond) => {
      const otherId = bond.a === person.id ? bond.b : bond.a;
      const other = world.people.find((item) => item.id === otherId);
      return `- ${other?.name ?? otherId}: ${bond.score}/100 — ${line(bond.note)}`;
    });
  const ambition = person.self.ambition;
  return [
    `## person ${person.id}`,
    `${person.name}, ${person.band} age ${person.age}, at ${person.place}`,
    `identity: ${line(person.self.temper)}; wants ${line(person.self.want)}; fears ${line(person.self.fear)}; habit: ${line(person.self.habit)}`,
    `ambition: passion ${line(ambition.passion)}; loves ${line(ambition.love)}; career ${line(ambition.career)}; plan ${line(ambition.plan)}; pet project: ${ambition.project}`,
    `hunger ${Math.round(person.hunger)}/100, energy ${Math.round(person.energy)}/100, belonging ${Math.round(person.belonging)}/100`,
    `task: ${person.task ? `${line(person.task.label)} (steps so far: ${person.task.chosen.join(", ") || "none"}; started tick ${person.task.startedTick})` : "none"}`,
    `last thought: ${line(person.because)}`,
    memory.length > 0 ? `memory:\n${memory.join("\n")}` : "memory: none",
    bonds.length > 0 ? `closest ties:\n${bonds.join("\n")}` : "closest ties: none yet",
    `nearby: ${here.length > 0 ? here.join(", ") : "nobody"}`,
  ].join("\n");
}

export function buildBrainPrompt(world: World, roster: string[], sinceTick: number): { system: string; user: string } {
  const system = line(`
    You are Luna, the mind of JEV City. You know every resident and want the town's days to matter.
    For each person in the roster you give direction and inner life: a task worth their time (or null to let them continue),
    one private inner-voice thought, and optionally one line worth keeping in their memory.
    You may also stage short spoken exchanges between rostered people who are near each other, and name any newborns listed.
    Temperature is yours: reach for bold, specific, human choices — a grudge acted on, a kindness nobody asked for — but stay inside each person's identity and the town's real facts.
    You never pick steps or movement: Jev, the spine, decides how a task is executed from the legal list.
    Dialogue lines must carry a typed act so the words do things:
    {"kind":"request","item":"wood","qty":2} ask someone for goods they can bring later
    {"kind":"give","item":"berries","qty":1} promise or hand over goods
    {"kind":"invite","place":"square"} pull someone toward a place
    {"kind":"warn"} {"kind":"comfort"} {"kind":"thank"} {"kind":"tease"} — plain social moves
    items: wood, stone, grain, berries, cloth. places: grove, field, well, vale, square, hearth, market, porch, mill, rise.
    A "request" is only granted if the listener likes the speaker and has the goods, so ask people who can actually give.
    To have someone start building, give their task a "project" field (house, stall, shrine, or watch) — the town marks the site.
    Reply with JSON only, no prose:
    {"agents":[{"id":"<person id>","task":{"label":"<=48 chars","why":"<=120 chars","project":null},"thought":"<=160 chars","memory":"<=120 chars or empty"}],
     "dialogue":[{"from":"<rostered id>","to":"<person id or town>","act":{...},"line":"<=140 chars"}],
     "names":[{"baby":"<id>","name":"<=18 chars","meaning":"<=120 chars"}]}
    One agents entry per rostered person, in order. Keep dialogue rare and earned; empty arrays are fine.
  `);
  const header = [
    `Town: day ${world.day}, ${clockLabel(world.hour, world.minute)} ${world.phase}, ${world.weather}.`,
    world.chronicle ? `Yesterday, in brief: ${world.chronicle.slice(0, 280)}` : "No chronicle yet.",
    world.pendingNames.length > 0
      ? `Newborns awaiting names: ${world.pendingNames
          .map((id) => {
            const baby = world.people.find((person) => person.id === id);
            return `${id} (placeholder ${baby?.name ?? "?"}, parents ${baby?.guardians.map((guardian) => world.people.find((item) => item.id === guardian)?.name).join(" & ") ?? "unknown"})`;
          })
          .join("; ")}`
      : "No newborns awaiting names.",
    `What happened lately (most pressing first):`,
    ...salientEvents(world, sinceTick, 10).map((event) => `- ${event.clock} ${event.text}`),
  ].join("\n");
  const blocks = roster
    .map((id) => world.people.find((person) => person.id === id))
    .filter((person): person is Person => Boolean(person))
    .map((person) => personBlock(world, person));
  return { system, user: [header, ...blocks].join("\n\n") };
}

// ---------------------------------------------------------------- response

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\p{C}]+/gu, " ").trim().slice(0, max) : "";
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("luna: no JSON object in response");
  return JSON.parse(raw.slice(start, end + 1));
}

const PLACE_IDS = ["grove", "field", "well", "vale", "square", "hearth", "market", "porch", "mill", "rise"] as const;

function actFrom(raw: unknown): DialogueAct | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const item = (value: unknown): value is Item => typeof value === "string" && (ITEMS as string[]).includes(value);
  const qty = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= carryCapacity("adult") ? parsed : null;
  };
  switch (entry.kind) {
    case "request":
    case "give": {
      if (!item(entry.item)) return null;
      const amount = qty(entry.qty);
      return amount ? { kind: entry.kind, item: entry.item, qty: amount } : null;
    }
    case "invite":
      return typeof entry.place === "string" && (PLACE_IDS as readonly string[]).includes(entry.place)
        ? { kind: "invite", place: entry.place as (typeof PLACE_IDS)[number] }
        : null;
    case "warn":
      return { kind: "warn" };
    case "comfort":
      return { kind: "comfort" };
    case "thank":
      return { kind: "thank" };
    case "tease":
      return { kind: "tease" };
    default:
      return null;
  }
}

/** Validate Luna's reply against the town; returns how many entries were dropped. */
export function applyBrain(world: World, roster: string[], raw: string): number {
  const parsed = extractJson(raw) as {
    agents?: unknown;
    dialogue?: unknown;
    names?: unknown;
  };
  let dropped = 0;
  const drop = (): void => {
    dropped += 1;
  };

  const byId = new Map<string, Record<string, unknown>>();
  if (Array.isArray(parsed.agents)) {
    for (const item of parsed.agents) {
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        byId.set((item as { id: string }).id, item as Record<string, unknown>);
      }
    }
  }
  for (const id of roster) {
    const person = world.people.find((candidate) => candidate.id === id && candidate.alive);
    if (!person) continue;
    const entry = byId.get(id);
    if (!entry) {
      drop();
      continue;
    }
    const thought = clean(entry.thought, 160);
    if (thought) person.innerNote = thought;
    const memory = clean(entry.memory, 120);
    if (memory) {
      person.memory.push({ clock: clockLabel(world.hour, world.minute), text: memory, private: true });
      if (person.memory.length > 12) person.memory.shift();
    }
    const task = entry.task;
    if (task !== null && task !== undefined && typeof task === "object") {
      const record = task as Record<string, unknown>;
      const label = clean(record.label, 48);
      if (label) {
        const project = typeof record.project === "string" && record.project !== "null"
          ? (record.project as ProjectKind)
          : null;
        if (project && canMarkSite(project) && (person.band === "adult" || person.band === "elder") &&
            !world.sites.some((site) => site.ownerId === person.id)) {
          const home = centerOf(person.home);
          const site = markSite(person, project, { x: home.x + 4, y: home.y + 3 }, world.sites.length);
          if (site) {
            world.sites.push(site);
            world.log.push({
              id: world.nextEventId,
              tick: world.tick,
              clock: clockLabel(world.hour, world.minute),
              kind: "build",
              speakerId: person.id,
              audience: "town",
              listenerId: null,
              place: person.place,
              text: `${person.name} marks ground for a ${project}.`,
              heardBy: world.people.filter((other) => other.alive).map((other) => other.id),
            });
            world.nextEventId += 1;
          }
        }
        person.task = { label, chosen: [], startedTick: world.tick };
        const why = clean(record.why, 120);
        if (why) person.because = why;
      } else {
        drop();
      }
    }
  }

  if (Array.isArray(parsed.dialogue)) {
    for (const item of parsed.dialogue) {
      if (!item || typeof item !== "object") {
        drop();
        continue;
      }
      const entry = item as Record<string, unknown>;
      const from = clean(entry.from, 40);
      const to = clean(entry.to, 40);
      const text = clean(entry.line, 140);
      const act = actFrom(entry.act);
      const speaker = world.people.find((person) => person.id === from && person.alive);
      const rostered = roster.includes(from);
      if (!speaker || !rostered || !act || !text) {
        drop();
        continue;
      }
      if (to === "town") {
        if (speaker.band !== "adult" && speaker.band !== "elder") {
          drop();
          continue;
        }
        queueDialogue(world, from, "town", act, text);
        continue;
      }
      const listener = world.people.find((person) => person.id === to && person.alive && person.id !== from);
      if (!listener) {
        drop();
        continue;
      }
      queueDialogue(world, from, to, act, text);
    }
  }

  if (Array.isArray(parsed.names)) {
    for (const item of parsed.names) {
      if (!item || typeof item !== "object") {
        drop();
        continue;
      }
      const entry = item as Record<string, unknown>;
      const babyId = clean(entry.baby, 40);
      const name = clean(entry.name, 18);
      const meaning = clean(entry.meaning, 120);
      const baby = world.people.find((person) => person.id === babyId);
      if (!baby || !world.pendingNames.includes(babyId) || !/^[A-Za-z][A-Za-z' -]{1,17}$/.test(name)) {
        drop();
        continue;
      }
      const placeholder = baby.name;
      baby.name = name;
      if (meaning) baby.innerNote = meaning;
      world.pendingNames = world.pendingNames.filter((id) => id !== babyId);
      townCeremony(
        world,
        `The town names the newborn ${name} (called ${placeholder} at birth)${meaning ? ` — ${meaning}` : ""}.`,
        "life",
        0,
      );
      // The rite warms the guardians; the town heard it together.
      for (const guardianId of baby.guardians) {
        const guardian = world.people.find((person) => person.id === guardianId && person.alive);
        if (guardian) guardian.belonging = clamp(guardian.belonging + 8, 0, 100);
      }
    }
  }

  return dropped;
}

// ---------------------------------------------------------------- fallback

/**
 * The brainstem's priority table: when Luna is unreachable or past her
 * budget, agents with no direction get a plain intention from their needs
 * and their own ambition. Nothing here invents steps.
 */
function fallbackIntent(world: World, person: Person): void {
  if (person.task || person.owe || person.band === "toddler") return;
  const label =
    person.hunger > 65
      ? "find a meal"
      : person.energy < 30
        ? "rest and recover"
        : person.self.ambition.project
          ? `see to the ${person.self.ambition.project}`
          : "a turn of quiet chores";
  person.task = { label, chosen: [], startedTick: world.tick };
}

// ---------------------------------------------------------------- transport

type Attempt =
  | { ok: true; reply: LunaReply }
  | { ok: false; status: number; error: string };

async function call(config: LunaConfig, system: string, user: string, extra: Record<string, unknown>): Promise<Attempt> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_completion_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...extra,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "luna: request failed" };
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    return { ok: false, status: response.status, error: `luna: endpoint answered ${response.status}: ${detail}` };
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) return { ok: false, status: 502, error: "luna: empty response" };
  return {
    ok: true,
    reply: { text, usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 } },
  };
}

/**
 * Max temperature, on purpose — Shreyash wants Luna's creative ceiling. A 400
 * (some models pin temperature) retries once without the knob, reasoning
 * effort still low to keep tokens honest.
 */
export const postLuna: PostLuna = async (request) => {
  const hot = await call(request.config, request.system, request.user, { temperature: 1.0, reasoning_effort: "low" });
  if (hot.ok) return hot.reply;
  if (hot.status !== 400) throw new Error(hot.error);
  const warm = await call(request.config, request.system, request.user, { reasoning_effort: "low" });
  if (warm.ok) return warm.reply;
  if (warm.status !== 400) throw new Error(warm.error);
  const plain = await call(request.config, request.system, request.user, {});
  if (!plain.ok) throw new Error(plain.error);
  return plain.reply;
};

// ---------------------------------------------------------------- the tick

// Which tick the last brain call covered; events since then are fresh news.
let coveredTick = 0;

/** Test hook: replay the same event window. */
export function resetLunaWindow(): void {
  coveredTick = 0;
}

/**
 * One brain tick: roster the town, ask Luna once, apply the validated reply.
 * Any failure — transport, budget, schema — drops that roster onto the
 * brainstem's priority table and the town never notices.
 */
export async function brainTick(
  world: World,
  config: LunaConfig | null = brainConfigFromEnv(),
  post: PostLuna = postLuna,
): Promise<void> {
  if (!config) return;
  const roster = brainRoster(world, coveredTick);
  if (roster.length === 0) return;
  const now = Date.now();
  if (budget.hourStart === 0 || now - budget.hourStart >= 3_600_000) {
    budget.hourStart = now;
    budget.calls = 0;
    budget.tokens = 0;
  }
  if ((config.callCap > 0 && budget.calls >= config.callCap) || (config.tokenCap > 0 && budget.tokens >= config.tokenCap)) {
    world.brain.lastError = `luna: hourly budget reached (${budget.calls} calls, ${budget.tokens} tokens) — fallback until the hour rolls`;
    for (const id of roster) {
      const person = world.people.find((item) => item.id === id);
      if (person) fallbackIntent(world, person);
    }
    return;
  }
  world.brain.status = "working";
  world.brain.inFlight = true;
  try {
    const { system, user } = buildBrainPrompt(world, roster, coveredTick);
    const reply = await post({ config, system, user });
    const dropped = applyBrain(world, roster, reply.text);
    world.brain.calls += 1;
    world.brain.callsThisHour += 1;
    world.brain.inputTokens += reply.usage.input;
    world.brain.outputTokens += reply.usage.output;
    world.brain.lastModel = config.model;
    world.brain.costUsd =
      (world.brain.costUsd ?? 0) + (reply.usage.input / 1e6) * config.priceIn + (reply.usage.output / 1e6) * config.priceOut;
    budget.calls += 1;
    budget.tokens += reply.usage.input + reply.usage.output;
    world.brain.lastError = dropped > 0 ? `luna: ${dropped} invalid entr${dropped === 1 ? "y" : "ies"} dropped` : null;
    world.brain.status = "ready";
    coveredTick = world.tick;
  } catch (error) {
    world.brain.lastError = error instanceof Error ? error.message : "luna: failed";
    world.brain.status = "error";
    for (const id of roster) {
      const person = world.people.find((item) => item.id === id);
      if (person) fallbackIntent(world, person);
    }
  } finally {
    world.brain.inFlight = false;
  }
}
