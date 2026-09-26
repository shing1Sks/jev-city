import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestions,
  decideWithJev,
  parseJevAnswers,
  resetJevBudget,
  spineEligible,
  type JevAnswer,
  type JevQuestion,
  type PostJev,
} from "../src/server/jev.js";
import { legalSteps } from "../src/world/rules.js";
import { applyDecision, createWorld, setClock, tick } from "../src/world/sim.js";
import type { Decision, Person, World } from "../src/world/types.js";
import { dist } from "../src/world/types.js";

const CONFIG = {
  apiKey: "test-key",
  model: "jev-test-model",
  baseUrl: "https://api.typesafe.ai/v1",
  priceIn: 0.042,
  priceOut: 0,
  tokenCap: 400_000,
};

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function reply(answers: Record<string, JevAnswer>): PostJev {
  return async () => ({ model: "jev-1.13.0-test", answers, usage: { input: 500, output: 60 } });
}

/** The six typed answers for one person, with per-field overrides. */
function stamp(overrides: Record<string, JevAnswer> = {}): Record<string, JevAnswer> {
  return {
    step: { type: "choice", choice: "rest", confidence: 0.9 },
    speak: { type: "noul", noul: 0 },
    keep: { type: "noul", noul: 0 },
    intent: { type: "choice", choice: "tell" },
    topic: { type: "choice", choice: "work" },
    tone: { type: "choice", choice: "soft" },
    ...overrides,
  };
}

/** Keyed answers for a whole batch: every listed person takes their given step. */
function batch(
  choices: Record<string, string>,
  extras: Record<string, Record<string, JevAnswer>> = {},
): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {};
  for (const [id, step] of Object.entries(choices)) {
    const fields = stamp({ step: { type: "choice", choice: step, confidence: 0.9 } });
    for (const [field, answer] of Object.entries(fields)) out[`q_${id}_${field}`] = answer;
    for (const [field, answer] of Object.entries(extras[id] ?? {})) out[`q_${id}_${field}`] = answer;
  }
  return out;
}

function firstLegal(world: World, id: string): string {
  return legalSteps(person(world, id), world)[0]?.id ?? "rest";
}

// ---------------------------------------------------------------- eligibility

test("spine eligibility: idle adults yes, toddlers, forced, and busy people no", () => {
  const world = createWorld();
  const adult = person(world, "jevoss");
  assert.equal(spineEligible(world, adult.id), true);

  assert.equal(spineEligible(world, "jevik"), false); // toddler stays on the brainstem

  adult.step = { kind: "rest", note: "resting", remaining: 5 };
  assert.equal(spineEligible(world, adult.id), false);
  adult.step = null;

  // A child out after dark is law-forced home: the brainstem owns that call.
  setClock(world, 21, 0);
  const kid = person(world, "jevlin");
  kid.x = 25;
  kid.y = 30;
  assert.equal(spineEligible(world, kid.id), false);
});

// ---------------------------------------------------------------- request

test("the spine request carries state, legal-step choices, and stamp choices", () => {
  const world = createWorld();
  const jevoss = person(world, "jevoss");
  jevoss.task = { label: "raise my house", chosen: ["deliver_jevoss-house-0"], startedTick: 3 };
  const { state, questions } = buildQuestions(world, [jevoss.id]);
  assert.match(state, /person jevoss/);
  assert.match(state, /raise my house/);

  const step = questions["q_jevoss_step"];
  if (!step || step.type !== "choice") throw new Error("step question missing");
  assert.ok("rest" in step.criteria, "legal rest option is a choice criterion");
  assert.ok(Object.keys(step.criteria).some((id) => id.startsWith("chop_")));
  assert.ok(Object.keys(step.criteria).every((id) => step.criteria[id] && step.criteria[id]!.length > 0));

  assert.equal(questions["q_jevoss_speak"]?.type, "noul");
  assert.equal(questions["q_jevoss_keep"]?.type, "noul");
  const intent = questions["q_jevoss_intent"];
  if (!intent || intent.type !== "choice") throw new Error("intent question missing");
  assert.ok("greet" in intent.criteria, "band lexicon ids are the intent options");
});

// ---------------------------------------------------------------- parsing

test("legal answers parse as a jev decision with clamped stamps and real confidence", () => {
  const world = createWorld();
  const answers = batch({ jevoss: "rest" }, {
    jevoss: {
      intent: { type: "choice", choice: "yolo" },
      topic: { type: "choice", choice: "volcano" },
      tone: { type: "choice", choice: "sparkly" },
      speak: { type: "noul", noul: 0.9 },
      keep: { type: "noul", noul: 1 },
    },
  });
  const decisions = parseJevAnswers(world, ["jevoss"], answers);
  assert.equal(decisions.length, 1);
  const decision = decisions[0];
  assert.equal(decision.source, "jev");
  assert.equal(decision.stepId, "rest");
  assert.equal(decision.speak, true);
  assert.equal(decision.task?.keep, true);
  assert.equal(decision.intentWord, "greet", "out-of-band stamps clamp to the allowed list");
  assert.equal(decision.topic, "food");
  assert.equal(decision.tone, "joy");
  assert.ok(Math.abs((decision.confidence ?? 0) - 0.9) < 1e-9, "the model's confidence rides through");
  assert.match(decision.because, /rest/i);
  assert.equal(world.soul.lastError, null);
});

test("an illegal step id falls back to the reflex for that person only", () => {
  const world = createWorld();
  const decisions = parseJevAnswers(world, ["jevoss"], batch({ jevoss: "fly_to_the_moon" }));
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].source, "reflex");
  assert.match(world.soul.lastError ?? "", /fell back to reflex/);
});

test("a reply with no usable answers reflexes everyone, in parsing and end to end", async () => {
  const world = createWorld();
  const decisions = parseJevAnswers(world, ["jevoss"], {});
  assert.equal(decisions[0].source, "reflex");
  assert.match(world.soul.lastError ?? "", /fell back to reflex/);
  // A 200 with an empty answer map still leaves nobody stepless.
  await decideWithJev(world, ["jevoss"], CONFIG, reply(batch({})));
  assert.ok(person(world, "jevoss").step);
});

// ---------------------------------------------------------------- transport

test("decideWithJev applies the mocked reply, counts the call, and starts tasks", async () => {
  const world = createWorld();
  await decideWithJev(
    world,
    ["jevoss", "jevaary"],
    CONFIG,
    reply(batch({ jevoss: "rest", jevaary: firstLegal(world, "jevaary") })),
  );
  assert.equal(world.soul.calls, 1);
  assert.equal(world.soul.inputTokens, 500);
  assert.equal(world.soul.outputTokens, 60);
  assert.equal(world.soul.lastModel, "jev-1.13.0-test", "the resolved model version lands in telemetry");
  assert.ok(person(world, "jevoss").step);
  assert.ok(person(world, "jevoss").task, "a fresh task starts from the chosen step");
  assert.ok(person(world, "jevaary").step);
});

test("a transport failure sends the whole batch to the reflex", async () => {
  const world = createWorld();
  const failing: PostJev = async () => {
    throw new Error("endpoint down");
  };
  await decideWithJev(world, ["jevoss", "jevaary"], CONFIG, failing);
  assert.match(world.soul.lastError ?? "", /endpoint down/);
  assert.ok(person(world, "jevoss").step);
  assert.ok(person(world, "jevaary").step);
  assert.equal(world.soul.calls, 0);
});

test("toddlers are decided locally without spending a spine call", async () => {
  const world = createWorld();
  let calls = 0;
  const counting: PostJev = async (request) => {
    calls += 1;
    assert.doesNotMatch(request.state, /jevik/);
    return { model: "jev-1.13.0-test", answers: batch({}), usage: { input: 10, output: 5 } };
  };
  await decideWithJev(world, ["jevik", "jevoss"], CONFIG, counting);
  assert.equal(calls, 1);
  assert.ok(person(world, "jevik").step); // brainstem gave the toddler a step
});

test("no config means pure reflex, no calls", async () => {
  const world = createWorld();
  await decideWithJev(world, ["jevoss"], null, reply(batch({ jevoss: "rest" })));
  assert.equal(world.soul.calls, 0);
  assert.ok(person(world, "jevoss").step);
});

test("spend accrues a dollar estimate from the price table", async () => {
  resetJevBudget();
  const world = createWorld();
  await decideWithJev(world, ["jevoss"], CONFIG, reply(batch({ jevoss: "rest" })));
  // 500 in @ $0.042/M + 60 out @ $0/M = $0.000021 (Jev output tokens are free).
  assert.ok(Math.abs((world.soul.costUsd ?? 0) - 0.000021) < 1e-9);
});

test("the hourly token valve drops the spine to reflex until the hour rolls", async () => {
  resetJevBudget();
  const world = createWorld();
  const capped = { ...CONFIG, tokenCap: 100 };
  // First call spends 560 tokens, blowing past the 100-token valve.
  await decideWithJev(world, ["jevoss"], capped, reply(batch({ jevoss: "rest" })));
  assert.equal(world.soul.calls, 1);
  assert.equal(world.soul.tokensThisHour, 560);
  const first = person(world, "jevoss");
  first.step = null; // the body finishes its step; the spine is asked again
  await decideWithJev(world, ["jevoss"], capped, reply(batch({ jevoss: "rest" })));
  assert.equal(world.soul.calls, 1, "no second call past the valve");
  assert.match(world.soul.lastError ?? "", /token cap reached/);
  assert.ok(person(world, "jevoss").step, "reflex still decided the step");
});

// ---------------------------------------------------------------- tasks

test("keepTask extends a task; dropping it starts a fresh one", () => {
  const world = createWorld();
  const decision = (stepId: string, task: Decision["task"]): Decision => ({
    personId: "jevoss",
    stepId,
    speak: false,
    audience: "here",
    listenerId: null,
    intentWord: "tell",
    topic: "work",
    tone: "soft",
    because: "test",
    task,
    source: "jev",
    confidence: 1,
  });
  applyDecision(world, decision("rest", { keep: false, label: "haul wood home" }));
  const started = person(world, "jevoss").task;
  assert.equal(started?.label, "haul wood home");
  // The body must finish a step before the spine is asked again.
  person(world, "jevoss").step = null;
  applyDecision(world, decision("express", { keep: true }));
  const kept = person(world, "jevoss").task;
  assert.equal(kept?.label, "haul wood home");
  assert.deepEqual(kept?.chosen, ["rest", "express"]);
  person(world, "jevoss").step = null;
  applyDecision(world, decision("rest", { keep: false }));
  const fresh = person(world, "jevoss").task;
  assert.notEqual(fresh?.label, "haul wood home");
  assert.deepEqual(fresh?.chosen, ["rest"]);
});

// ---------------------------------------------------------------- end to end

test("a mocked spine drives the house build end to end", async () => {
  const world = createWorld();
  const jevoss = person(world, "jevoss");
  world.storages[jevoss.household].wood = 6;
  world.storages[jevoss.household].stone = 4;

  // The mock always reaches for the build: deliver materials while any are owed.
  const builder: PostJev = async () => {
    const options = legalSteps(jevoss, world);
    const step =
      options.find((option) => option.id.startsWith("deliver_")) ??
      options.find((option) => option.id.startsWith("build_")) ??
      options[0];
    return {
      model: "jev-1.13.0-test",
      answers: batch({ [jevoss.id]: step?.id ?? "rest" }, { [jevoss.id]: { keep: { type: "noul", noul: 1 } } }),
      usage: { input: 120, output: 30 },
    };
  };

  for (let limit = 0; limit < 900 && world.expansions.length === 0; limit += 1) {
    const ids = tick(world, "open");
    if (ids.length > 0) await decideWithJev(world, ids, CONFIG, builder);
  }

  assert.ok(world.expansions.some((item) => item.id === "jevoss-house-0"), "the house should stand");
  assert.ok(world.sites.length === 0);
  assert.ok(world.soul.calls > 0);
  // Every applied choice stayed inside the legal list; nobody wandered off map.
  assert.ok(dist(jevoss, { x: 62, y: 78 }) < 90);
});
