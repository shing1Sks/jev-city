import { carryLabel } from "../world/carry.js";
import { allowedIntentIds, allowedTopicIds, allowedToneIds, INTENTS, TOPICS, TONES } from "../world/lexicon.js";
import { placeOf } from "../world/map.js";
import { recallFor } from "../world/memory.js";
import { reflexDecide } from "../world/reflex.js";
import { forcedStep, legalSteps } from "../world/rules.js";
import { applyDecision } from "../world/sim.js";
import { othersHere } from "../world/speech.js";
import type { Decision, Person, World } from "../world/types.js";

/**
 * Jev, the spine — one SystemOne call per batch. The shared `state` text says
 * who everyone is, what they were doing, and what surrounds them; the typed
 * questions carry the choices themselves: one legal-step choice, a speak/keep
 * noul pair, and three lexicon-stamp choices per person. Answers come back
 * keyed by question name (q_<personId>_<field>) and are re-checked against the
 * live legal step list; anything missing or illegal falls back to the
 * brainstem reflex for that person only. Jev never writes dialogue — it picks
 * stamps from the lexicon.
 */

export interface JevConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  /** US dollars per million input tokens, for the running-cost estimate. */
  priceIn: number;
  /** US dollars per million output tokens (Jev output tokens are free: 0). */
  priceOut: number;
  /** Input+output tokens per rolling hour before the valve drops to reflex; 0 disables. */
  tokenCap: number;
}

function numEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function jevConfigFromEnv(): JevConfig | null {
  const apiKey = process.env.TYPESAFE_API_KEY ?? process.env.JEV;
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.JEV_MODEL ?? process.env.TYPESAFE_MODEL ?? "jev-latest",
    baseUrl: process.env.JEV_BASE_URL ?? process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai/v1",
    // TypeSafe lists Jev at $42 per billion input tokens; output tokens are free.
    priceIn: numEnv("JEV_PRICE_IN", 0.042),
    priceOut: numEnv("JEV_PRICE_OUT", 0),
    tokenCap: numEnv("JEV_HOURLY_TOKEN_CAP", 2_500_000),
  };
}

// Rolling one-hour spend window, in server memory: the safety valve lives here
// so old saves and other entry points never carry it.
const budget = { hourStart: 0, spent: 0 };

/** Test hook: start the hourly token window fresh. */
export function resetJevBudget(): void {
  budget.hourStart = 0;
  budget.spent = 0;
}

// ---------------------------------------------------------------- wire types

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string };

export interface JevAnswer {
  type?: string;
  choice?: unknown;
  noul?: unknown;
  confidence?: unknown;
}

export interface JevRequest {
  config: JevConfig;
  state: string;
  questions: Record<string, JevQuestion>;
}

export interface JevReply {
  /** The concrete model version that answered, e.g. "jev-1.13.0". */
  model?: string;
  answers: Record<string, JevAnswer>;
  usage: { input: number; output: number };
}

export type PostJev = (request: JevRequest) => Promise<JevReply>;

/** Brainstem interrupts and toddlers never spend a spine call. */
export function spineEligible(world: World, id: string): boolean {
  const person = world.people.find((item) => item.id === id);
  if (!person || !person.alive || person.step) return false;
  if (person.band === "toddler") return false;
  return forcedStep(person, world) === null;
}

// ---------------------------------------------------------------- request

function line(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const intentLabel = new Map(INTENTS.map((item) => [item.id, item.label]));
const topicLabel = new Map(TOPICS.map((item) => [item.id, item.label]));
const toneLabel = new Map(TONES.map((item) => [item.id, item.label]));

/** Stamp ids are plain words ("greet", "food", "joy") — null criteria keeps the call lean. */
function stampCriteria(ids: string[], labels: Map<string, string>): Record<string, string | null> {
  return Object.fromEntries(ids.map((id) => [id, labels.get(id) ?? null]));
}

function personBlock(world: World, person: Person): string {
  const near = othersHere(person, world).filter((other) => other.id !== person.id);
  const here = near.map((other) => other.name);
  const holding = carryLabel(person.carry);
  const memory = recallFor(world, person, { nearby: near.map((other) => other.id), task: person.task?.label }).map(
    (item) => `- ${line(item.text)}`,
  );
  // Legal steps and stamps are NOT listed here: they are the choice questions'
  // criteria, so the model sees each option exactly once, where it matters.
  return [
    `## person ${person.id}`,
    `${person.name}, ${person.band}, home ${placeOf(person.home).name}, now at ${placeOf(person.place).name}; ${line(world.weather)} ${world.phase}`,
    `self: ${line(person.self.temper)}; wants ${line(person.self.want)}; fears ${line(person.self.fear)}`,
    `hunger ${Math.round(person.hunger)}/100, energy ${Math.round(person.energy)}/100, belonging ${Math.round(person.belonging)}/100`,
    `carrying: ${holding || "nothing"}`,
    `task: ${person.task ? `${line(person.task.label)} (steps so far: ${person.task.chosen.join(", ") || "none"})` : "none"}`,
    `last thought: ${line(person.because)}`,
    memory.length > 0 ? `memory:\n${memory.join("\n")}` : "memory: none",
    `nearby: ${here.length > 0 ? here.join(", ") : "nobody"}`,
  ].join("\n");
}

export function buildQuestions(world: World, ids: string[]): { state: string; questions: Record<string, JevQuestion> } {
  const header = `Town: day ${world.day}, ${String(world.hour).padStart(2, "0")}:${String(world.minute).padStart(2, "0")} ${world.phase}, ${world.weather}.`;
  const questions: Record<string, JevQuestion> = {};
  const blocks: string[] = [];
  for (const id of ids) {
    const person = world.people.find((item) => item.id === id);
    if (!person) continue;
    blocks.push(personBlock(world, person));
    const q = (field: string): string => `q_${person.id}_${field}`;
    questions[q("step")] = {
      type: "choice",
      instructions: `Next step for ${person.name} (${person.id}) right now?`,
      criteria: Object.fromEntries(
        legalSteps(person, world).map((option) => [option.id, `${option.label} — ${line(option.detail)}`.slice(0, 120)]),
      ),
    };
    questions[q("speak")] = { type: "noul", instructions: `Should ${person.name} voice a feeling to those nearby right now?` };
    questions[q("keep")] = {
      type: "noul",
      instructions: `Should ${person.name} keep working on the current task (${person.task ? line(person.task.label) : "none"})?`,
    };
    questions[q("intent")] = { type: "choice", instructions: `Body-language intent if ${person.name} speaks.`, criteria: stampCriteria(allowedIntentIds(person.band), intentLabel) };
    questions[q("topic")] = { type: "choice", instructions: `What ${person.name} would speak about.`, criteria: stampCriteria(allowedTopicIds(person.band), topicLabel) };
    questions[q("tone")] = { type: "choice", instructions: `Tone of ${person.name}'s expression.`, criteria: stampCriteria(allowedToneIds(person.band), toneLabel) };
  }
  return { state: [header, ...blocks].join("\n\n"), questions };
}

// ---------------------------------------------------------------- response

function choiceOf(answer: JevAnswer | undefined): string {
  return typeof answer?.choice === "string" ? answer.choice : "";
}

function noulOf(answer: JevAnswer | undefined): number | null {
  const value = answer?.noul;
  return typeof value === "number" && value >= 0 && value <= 1 ? value : null;
}

/** Validate the answers for one person against the live legal list; null means fall back. */
function decisionFrom(world: World, person: Person, answers: Record<string, JevAnswer>): Decision | null {
  const q = (field: string): JevAnswer | undefined => answers[`q_${person.id}_${field}`];
  const option = legalSteps(person, world).find((item) => item.id === choiceOf(q("step")));
  if (!option) return null;
  const intents = allowedIntentIds(person.band);
  const topics = allowedTopicIds(person.band);
  const tones = allowedToneIds(person.band);
  const fallback = <T extends string>(value: string, allowed: T[], otherwise: T): T =>
    allowed.includes(value as T) ? (value as T) : otherwise;
  const speak = noulOf(q("speak"));
  const keep = noulOf(q("keep"));
  const confidence = q("step")?.confidence;
  return {
    personId: person.id,
    stepId: option.id,
    speak: speak === null ? true : speak >= 0.5,
    audience: "here",
    listenerId: null,
    intentWord: fallback(choiceOf(q("intent")), intents, intents[0] ?? "tell"),
    topic: fallback(choiceOf(q("topic")), topics, topics[0] ?? "work"),
    tone: fallback(choiceOf(q("tone")), tones, tones[0] ?? "soft"),
    // Jev never authors language: the record carries the chosen step's own label.
    because: option.label.toLowerCase(),
    task: { keep: keep !== null && keep >= 0.5 },
    source: "jev",
    confidence: typeof confidence === "number" ? Math.min(1, Math.max(0, confidence)) : 1,
  };
}

/**
 * Parse a keyed answer map into decisions, one per requested id, in order.
 * Missing or illegal entries fall back to the reflex for that person only;
 * world.soul.lastError records how many needed the safety net.
 */
export function parseJevAnswers(world: World, ids: string[], answers: Record<string, JevAnswer>): Decision[] {
  const map = answers && typeof answers === "object" ? answers : {};
  const decisions: Decision[] = [];
  let fallbacks = 0;
  for (const id of ids) {
    const person = world.people.find((item) => item.id === id);
    if (!person || !person.alive || person.step) continue;
    const decision = decisionFrom(world, person, map);
    if (decision) decisions.push(decision);
    else {
      decisions.push(reflexDecide(world, id));
      fallbacks += 1;
    }
  }
  world.soul.lastError = fallbacks > 0 ? `jev: ${fallbacks} of ${ids.length} decision(s) fell back to reflex` : null;
  return decisions;
}

// ---------------------------------------------------------------- transport

export const postJev: PostJev = async (request) => {
  const response = await fetch(`${request.config.baseUrl}/systemone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${request.config.apiKey}`,
    },
    body: JSON.stringify({
      state: request.state,
      model: request.config.model,
      questions: request.questions,
    }),
  });
  if (!response.ok) {
    throw new Error(`jev: endpoint answered ${response.status}`);
  }
  const data = (await response.json()) as {
    model?: unknown;
    answers?: unknown;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (!data.answers || typeof data.answers !== "object") {
    throw new Error("jev: no answers object in response");
  }
  return {
    model: typeof data.model === "string" ? data.model : undefined,
    answers: data.answers as Record<string, JevAnswer>,
    usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
  };
};

/**
 * Ask the spine for the next step of every id given. Ids the brainstem owns
 * (toddlers, law-forced, already stepping) are decided locally for free; the
 * rest share one typed call. Any transport failure sends the whole batch to
 * the reflex so the town never stalls.
 */
export async function decideWithJev(
  world: World,
  ids: string[],
  config: JevConfig | null = jevConfigFromEnv(),
  post: PostJev = postJev,
): Promise<void> {
  const spine = ids.filter((id) => spineEligible(world, id));
  const local = ids.filter((id) => !spine.includes(id));
  for (const id of local) applyDecision(world, reflexDecide(world, id));
  if (spine.length === 0) return;
  if (!config) {
    for (const id of spine) applyDecision(world, reflexDecide(world, id));
    return;
  }
  const { state, questions } = buildQuestions(world, spine);
  const now = Date.now();
  if (budget.hourStart === 0 || now - budget.hourStart >= 3_600_000) {
    budget.hourStart = now;
    budget.spent = 0;
  }
  if (config.tokenCap > 0 && budget.spent >= config.tokenCap) {
    // Jev is paid now: past the hourly valve the brainstem finishes the hour.
    world.soul.lastError = `jev: hourly token cap reached (${config.tokenCap}) — reflex until the hour rolls`;
    for (const id of spine) applyDecision(world, reflexDecide(world, id));
    return;
  }
  try {
    const reply = await post({ config, state, questions });
    const decisions = parseJevAnswers(world, spine, reply.answers);
    world.soul.calls += 1;
    world.soul.inputTokens += reply.usage.input;
    world.soul.outputTokens += reply.usage.output;
    world.soul.lastModel = reply.model ?? config.model;
    budget.spent += reply.usage.input + reply.usage.output;
    world.soul.tokensThisHour = budget.spent;
    world.soul.costUsd = (world.soul.costUsd ?? 0) + (reply.usage.input / 1e6) * config.priceIn + (reply.usage.output / 1e6) * config.priceOut;
    for (const decision of decisions) applyDecision(world, decision);
  } catch (error) {
    world.soul.lastError = error instanceof Error ? error.message : "jev: failed";
    for (const id of spine) applyDecision(world, reflexDecide(world, id));
  }
}
