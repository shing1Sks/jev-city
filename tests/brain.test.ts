import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBrain,
  brainRoster,
  brainTick,
  buildBrainPrompt,
  resetLunaBudget,
  resetLunaWindow,
  type LunaConfig,
  type PostLuna,
} from "../src/server/brain.js";
import { rosterFromEvents, salientEvents } from "../src/world/salience.js";
import { applyDecision, createWorld, deliverDialogue, queueDialogue, tick } from "../src/world/sim.js";
import { reflexDecide } from "../src/world/reflex.js";
import type { CityEvent, Person, World } from "../src/world/types.js";
import { bondKey } from "../src/world/types.js";

const CONFIG: LunaConfig = {
  apiKey: "test-key",
  model: "luna-test-model",
  baseUrl: "https://api.openai.com/v1",
  priceIn: 0.1,
  priceOut: 0.5,
  tokenCap: 0,
  callCap: 0,
};

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function lunaReply(
  text: string,
  usage: { input: number; output: number } = { input: 500, output: 100 },
  calls: { n: number } = { n: 0 },
): PostLuna {
  return async () => {
    calls.n += 1;
    return { text, usage };
  };
}

const EMPTY_REPLY = JSON.stringify({ agents: [], dialogue: [], names: [] });

/** No seed tasks or log: rosters come only from what the test itself stages. */
function clearTasks(world: World): void {
  for (const item of world.people) item.task = null;
  world.log.length = 0;
}

function pushEvent(world: World, event: Partial<CityEvent>): CityEvent {
  const full: CityEvent = {
    id: world.nextEventId,
    tick: world.tick,
    clock: "08:00",
    kind: "speech",
    speakerId: null,
    audience: null,
    listenerId: null,
    place: "square",
    text: "something happened",
    heardBy: [],
    ...event,
  };
  world.log.push(full);
  world.nextEventId += 1;
  return full;
}

/** Reflex-mode town loop: the spine's job done by the brainstem, like the server does. */
function runReflex(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    tick(world, "reflex");
    for (const item of world.people) {
      if (item.alive && !item.step) applyDecision(world, reflexDecide(world, item.id));
    }
  }
}

// ---------------------------------------------------------------- salience

test("salience ranks kinds by weight and fades old events out", () => {
  const world = createWorld();
  world.log.length = 0;
  pushEvent(world, { kind: "move", text: "someone walked", tick: 0 });
  pushEvent(world, { kind: "life", text: "a child was born", tick: 0 });
  const ranked = salientEvents(world, -10, 5);
  assert.match(ranked[0]?.text ?? "", /born/);

  // A birth four hours old loses to fresh weather: the fade is real.
  world.log.length = 0;
  pushEvent(world, { kind: "life", text: "old birth", tick: 0 });
  pushEvent(world, { kind: "weather", text: "rain coming", tick: 200 });
  world.tick = 240;
  const faded = salientEvents(world, -10, 5);
  assert.match(faded[0]?.text ?? "", /rain/);
});

test("rosterFromEvents collects the involved above threshold, in order", () => {
  const world = createWorld();
  world.log.length = 0;
  pushEvent(world, {
    kind: "speech",
    audience: "private",
    speakerId: "jevoss",
    listenerId: "jevine",
    text: "a private word",
  });
  pushEvent(world, { kind: "speech", audience: "here", speakerId: "jevon", text: "small talk" });
  pushEvent(world, { kind: "move", speakerId: "jevora", text: "footsteps" });
  const roster = rosterFromEvents(world, -10);
  assert.deepEqual(roster, ["jevoss", "jevine"]);
});

// ---------------------------------------------------------------- roster

test("brainRoster: event-involved first, stale tasks next, toddlers never, cap eight", () => {
  const world = createWorld();
  clearTasks(world);
  world.log.length = 0;
  pushEvent(world, { kind: "law", speakerId: "jevon", text: "a lawful moment" });

  const roster = brainRoster(world, 0);
  assert.equal(roster[0], "jevon", "the person a notable event touched comes first");
  assert.ok(!roster.includes("jevik"), "toddlers stay on the brainstem");
  assert.ok(roster.length <= 8);

  // Stale tasks rise to the top of the stale pool; fresh tasks stay out.
  const stale = person(world, "jevoss");
  stale.task = { label: "old errand", chosen: [], startedTick: world.tick - 200 };
  const fresh = person(world, "jevaary");
  fresh.task = { label: "fresh errand", chosen: [], startedTick: world.tick };
  const next = brainRoster(world, 0);
  assert.ok(next.includes("jevoss"), "stale makes the roster");
  assert.ok(!next.includes("jevaary"), "fresh stays out");
});

// ---------------------------------------------------------------- applyBrain

test("applyBrain applies tasks, thoughts, memory, dialogue, and names; drops bad entries", () => {
  const world = createWorld();
  const roster = ["jevoss", "jevaary"];
  world.pendingNames.push("jevora");
  const raw = JSON.stringify({
    agents: [
      {
        id: "jevoss",
        task: { label: "mend the fence", why: "it leans north" },
        thought: "The fence first, then the well.",
        memory: "Jevaary owes me a favor.",
      },
      { id: "jevaary", task: null, thought: "", memory: "" },
    ],
    dialogue: [
      { from: "jevoss", to: "jevine", act: { kind: "request", item: "wood", qty: 2 }, line: "Spare two wood, Jevine?" },
      { from: "jevoss", to: "jevine", act: { kind: "request", item: "gold", qty: 2 }, line: "gold is not real" },
      { from: "jevora", to: "jevoss", act: { kind: "warn" }, line: "not rostered" },
    ],
    names: [{ baby: "jevora", name: "Luma", meaning: "born at first light" }],
  });

  const dropped = applyBrain(world, roster, raw);

  const jevoss = person(world, "jevoss");
  assert.equal(jevoss.task?.label, "mend the fence");
  assert.equal(jevoss.because, "it leans north");
  assert.equal(jevoss.innerNote, "The fence first, then the well.");
  assert.ok(jevoss.memory.some((item) => item.text === "Jevaary owes me a favor."));
  assert.equal(person(world, "jevaary").task, null, "a null task is continue, not a drop");

  assert.equal(world.dialogue.length, 1);
  assert.equal(world.dialogue[0]?.act.kind, "request");
  assert.equal(person(world, "jevora").name, "Luma");
  assert.equal(world.pendingNames.length, 0);
  assert.equal(dropped, 2);
});

// ---------------------------------------------------------------- valves

test("brainTick stops at the hourly call cap and falls back to the brainstem", async () => {
  resetLunaBudget();
  resetLunaWindow();
  const world = createWorld();
  clearTasks(world);
  const calls = { n: 0 };
  const post = lunaReply(EMPTY_REPLY, { input: 100, output: 20 }, calls);
  const config = { ...CONFIG, callCap: 1 };

  await brainTick(world, config, post);
  assert.equal(calls.n, 1);
  assert.equal(world.brain.calls, 1);

  await brainTick(world, config, post);
  assert.equal(calls.n, 1, "the cap holds");
  assert.match(world.brain.lastError ?? "", /hourly budget/);
  assert.ok(person(world, "jevaary").task, "a rostered taskless person got a fallback intent");
});

test("brainTick stops at the hourly token cap", async () => {
  resetLunaBudget();
  resetLunaWindow();
  const world = createWorld();
  clearTasks(world);
  const calls = { n: 0 };
  const post = lunaReply(EMPTY_REPLY, { input: 5_000, output: 500 }, calls);
  const config = { ...CONFIG, tokenCap: 1_000 };

  await brainTick(world, config, post);
  assert.equal(calls.n, 1);
  await brainTick(world, config, post);
  assert.equal(calls.n, 1);
  assert.match(world.brain.lastError ?? "", /hourly budget/);
});

test("brainTick with no config does nothing; a failed call falls back without a crash", async () => {
  resetLunaBudget();
  resetLunaWindow();
  const world = createWorld();
  clearTasks(world);

  await brainTick(world, null);
  assert.equal(world.brain.calls, 0);
  assert.equal(world.brain.status, "off");

  const post: PostLuna = async () => {
    throw new Error("luna: boom");
  };
  await brainTick(world, CONFIG, post);
  assert.equal(world.brain.status, "error");
  assert.match(world.brain.lastError ?? "", /boom/);
  assert.ok(person(world, "jevaary").task, "fallback intent after the failure");
});

test("brainTick books tokens and real cost at the configured prices", async () => {
  resetLunaBudget();
  resetLunaWindow();
  const world = createWorld();
  clearTasks(world);
  await brainTick(world, CONFIG, lunaReply(EMPTY_REPLY, { input: 1_000, output: 200 }));
  assert.equal(world.brain.calls, 1);
  assert.equal(world.brain.inputTokens, 1_000);
  assert.equal(world.brain.outputTokens, 200);
  // 1000 × $0.10/M + 200 × $0.50/M = $0.0002
  assert.ok(Math.abs((world.brain.costUsd ?? 0) - 0.0002) < 1e-9);
  assert.equal(world.brain.lastModel, "luna-test-model");
});

// ---------------------------------------------------------------- prompt

test("the brain prompt carries identity, newborns, and the typed-act contract", () => {
  const world = createWorld();
  world.pendingNames.push("jevora");
  const { system, user } = buildBrainPrompt(world, ["jevoss"], 0);
  assert.match(system, /You are Luna/);
  assert.match(system, /JSON only/);
  assert.match(system, /"request"/);
  assert.match(user, /person jevoss/);
  assert.match(user, /Newborns awaiting names/);
  assert.match(user, /jevora/);
});

// ---------------------------------------------------------------- dialogue acts

test("a co-located request creates an owe, and the reflex spine keeps the promise", () => {
  const world = createWorld();
  // No build sites: the favor must not compete with housemates hauling wood.
  world.sites.length = 0;
  const asker = person(world, "jevoss");
  const giver = person(world, "jevaary");
  asker.x = 40;
  asker.y = 40;
  giver.x = 41;
  giver.y = 40;
  const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(asker.id, giver.id));
  if (bond) bond.score = 60;
  else world.bonds.push({ a: asker.id, b: giver.id, score: 60, love: 10, jealousy: 0, hate: 0, rivalry: 0, note: "old friends" });
  const storage = world.storages[giver.household] ?? {
    wood: 0,
    stone: 0,
    grain: 0,
    berries: 0,
    cloth: 0,
  };
  world.storages[giver.household] = storage;
  // A working pantry: the favor should not have to fight famine-boosted foraging.
  storage.wood = 6;
  storage.berries = 20;
  storage.grain = 10;
  const woodBefore = (world.storages[asker.household]?.wood ?? 0) + (asker.carry.wood ?? 0);

  queueDialogue(world, asker.id, giver.id, { kind: "request", item: "wood", qty: 2 }, "Lend me two wood, friend.");
  tick(world, "reflex");

  assert.ok(giver.owe, "the listener took on the favor");
  assert.equal(giver.owe?.item, "wood");
  assert.equal(giver.owe?.qty, 2);

  // Run until the favor is kept (or 900 ticks), not a fixed count: the town
  // log only keeps ~80 events, so finishing late would scroll the delivery out.
  for (let i = 0; i < 900; i += 1) {
    tick(world, "reflex");
    for (const item of world.people) {
      if (item.alive && !item.step) applyDecision(world, reflexDecide(world, item.id));
    }
    if (i > 0 && giver.owe === null) break;
  }

  assert.equal(giver.owe, null, "the favor was kept");
  const woodAfter = (world.storages[asker.household]?.wood ?? 0) + (asker.carry.wood ?? 0);
  assert.ok(woodAfter >= woodBefore + 2, "the goods really moved");
  assert.ok(
    world.log.some((event) => /hands 2 wood/.test(event.text)),
    "the delivery entered the town log",
  );
  const after = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(asker.id, giver.id));
  assert.ok((after?.score ?? 0) >= 60, "keeping a promise does not cool the bond");
});

test("dialogue waits for co-location and expires unheard", () => {
  const world = createWorld();
  const asker = person(world, "jevoss");
  const giver = person(world, "jevaary");
  asker.x = 20;
  asker.y = 20;
  giver.x = 85;
  giver.y = 85;
  const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(asker.id, giver.id));
  if (bond) bond.score = 60;
  else world.bonds.push({ a: asker.id, b: giver.id, score: 60, love: 10, jealousy: 0, hate: 0, rivalry: 0, note: "old friends" });
  const storage = world.storages[giver.household] ?? { wood: 0, stone: 0, grain: 0, berries: 0, cloth: 0 };
  world.storages[giver.household] = storage;
  storage.wood = 6;

  // Driven through the exported delivery pass so positions are exact; the
  // full-tick version of this behavior is the request e2e above.
  queueDialogue(world, asker.id, giver.id, { kind: "request", item: "wood", qty: 2 }, "Come lend me two wood.");
  deliverDialogue(world);
  assert.equal(giver.owe ?? null, null, "too far to hear it");
  assert.equal(world.dialogue.length, 1, "still waiting");

  giver.x = asker.x;
  giver.y = asker.y;
  deliverDialogue(world);
  assert.equal(giver.owe?.qty, 2, "delivered the moment they share air");
  assert.equal(world.dialogue.length, 0);

  queueDialogue(world, asker.id, giver.id, { kind: "tease" }, "Nice hat.");
  const entry = world.dialogue[0];
  if (!entry) throw new Error("entry missing");
  world.tick = entry.expires + 1;
  deliverDialogue(world);
  assert.equal(world.dialogue.length, 0, "expired unheard");
});

test("a private delivered line is heard only by the two present", () => {
  const world = createWorld();
  const speaker = person(world, "jevoss");
  const listener = person(world, "jevaary");
  const outsider = person(world, "jevon");
  speaker.x = 40;
  speaker.y = 40;
  listener.x = 41;
  listener.y = 40;
  outsider.x = 90;
  outsider.y = 20;
  const outsiderMemories = outsider.memory.length;

  queueDialogue(world, speaker.id, listener.id, { kind: "comfort" }, "You are not alone in this.");
  tick(world, "reflex");

  assert.equal(world.dialogue.length, 0, "delivered on co-location");
  assert.ok(
    listener.memory.some((item) => item.text.includes("not alone")),
    "the listener keeps the line",
  );
  assert.equal(outsider.memory.length, outsiderMemories, "the far outsider heard nothing");
});

// ---------------------------------------------------------------- names

test("an unparsable naming is dropped and the placeholder survives", () => {
  const world = createWorld();
  world.pendingNames.push("jevora");
  const before = person(world, "jevora").name;
  const dropped = applyBrain(
    world,
    ["jevoss"],
    JSON.stringify({
      agents: [{ id: "jevoss", task: null, thought: "", memory: "" }],
      dialogue: [],
      names: [{ baby: "jevora", name: "xX_sniper_Xx", meaning: "no" }],
    }),
  );
  assert.equal(dropped, 1);
  assert.equal(person(world, "jevora").name, before);
  assert.equal(world.pendingNames.length, 1, "Luna can try again next tick");
});
