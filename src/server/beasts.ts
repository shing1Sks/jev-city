import type { AnimalMove, World } from "../world/types.js";

/**
 * The laya animal mind: an optional local model that suggests one urge per
 * animal, the way the spine suggests steps. Same SystemOne wire shape, pointed
 * at LAYA_URL; the code instincts in world/animals.ts stay the fallback and
 * the law — a suggested move only lands if it is legal for that body.
 */

export interface BeastConfig {
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

export type PostBeast = (
  config: BeastConfig,
  body: { state: string; model: string; questions: Record<string, unknown> },
) => Promise<{ answers: Record<string, { choice?: string }> }>;

export function beastConfigFromEnv(): BeastConfig | null {
  const baseUrl = process.env.LAYA_URL;
  if (!baseUrl) return null;
  return {
    baseUrl,
    model: process.env.LAYA_MODEL ?? "jev-latest",
    apiKey: process.env.LAYA_KEY ?? null,
  };
}

const MOVES: Record<string, AnimalMove[]> = {
  crow: ["wander", "steal", "flee", "rest"],
  deer: ["wander", "graze", "flee", "rest"],
  dog: ["wander", "follow", "flee", "rest"],
};

const MOVE_LABEL: Record<AnimalMove, string> = {
  wander: "roam somewhere new",
  graze: "stand and eat greens",
  steal: "fly to a ripe berry bush and eat from it",
  flee: "get away from people fast",
  follow: "tag along near a person",
  rest: "settle down and doze",
};

/** Urge validity, mirrored from the animal bodies so the model never surprises them. */
export function legalMovesFor(kind: string): AnimalMove[] {
  return MOVES[kind] ?? ["wander", "rest"];
}

function buildQuestions(world: World): {
  state: string;
  questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string | null> }>;
  animals: World["animals"];
} {
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string | null> }> = {};
  const roster = world.animals.filter((animal) => legalMovesFor(animal.kind).length > 0);
  const lines = roster.map((animal) => {
    const options = legalMovesFor(animal.kind);
    questions[`q_${animal.id}_move`] = {
      type: "choice",
      instructions: `Next urge for this wild ${animal.kind}. One option id, nothing else.`,
      criteria: Object.fromEntries(options.map((move) => [move, MOVE_LABEL[move]])),
    };
    return `- ${animal.kind} "${animal.id}" at x ${Math.round(animal.x)}, y ${Math.round(animal.y)}; fear ${Math.round(animal.fear)}/100, hunger ${Math.round(animal.hunger)}/100; legal moves: ${options.join(", ")}`;
  });
  const state = [
    `A small valley town. ${world.phase}, ${world.weather}, day ${world.day}. Wild animals live at its edges.`,
    ...lines,
    `Choose one legal move per animal. Rest at night; flee when afraid.`,
  ].join("\n");
  return { state, questions, animals: roster };
}

async function postDefault(config: BeastConfig, body: { state: string; model: string; questions: Record<string, unknown> }) {
  const response = await fetch(`${config.baseUrl}/systemone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`laya ${response.status}`);
  return (await response.json()) as { answers: Record<string, { choice?: string }> };
}

/**
 * One batched laya call for the whole menagerie. Anything missing, illegal,
 * or unreachable simply falls through to the instincts — the animals never
 * wait on the model.
 */
export async function beastTick(
  world: World,
  config: BeastConfig | null,
  post: PostBeast = postDefault,
): Promise<void> {
  if (!config) {
    world.beast.status = "off";
    return;
  }
  if (world.animals.length === 0) return;
  world.beast.status = "working";
  try {
    const { state, questions, animals } = buildQuestions(world);
    const payload = await post(config, { state, model: config.model, questions });
    const answers = payload.answers ?? {};
    let applied = 0;
    for (const animal of animals) {
      const choice = answers[`q_${animal.id}_move`]?.choice;
      if (typeof choice !== "string") continue;
      if (!legalMovesFor(animal.kind).includes(choice as AnimalMove)) continue;
      // The bodies re-check feasibility themselves (a steal needs a ripe bush).
      animal.bias = { kind: choice as AnimalMove, untilTick: world.tick + 90 };
      applied += 1;
    }
    world.beast.calls += 1;
    world.beast.status = "ready";
    world.beast.lastError = applied === 0 ? "laya answered but no urge was legal" : null;
  } catch (error) {
    world.beast.status = "error";
    world.beast.lastError = (error instanceof Error ? error.message : "laya failed").slice(0, 160);
  }
}
