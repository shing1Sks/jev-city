import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestions } from "../src/server/jev.js";
import { consolidate, fadedSalience, recallFor, storeMemory } from "../src/world/memory.js";
import { createWorld, deliverDialogue } from "../src/world/sim.js";
import type { MemoryLine, Person, World } from "../src/world/types.js";
import { bondKey } from "../src/world/types.js";

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function line(text: string, over: Partial<MemoryLine> = {}): MemoryLine {
  return { clock: "08:00", text, private: false, at: 0, ...over };
}

// ---------------------------------------------------------------- the ring

test("eviction follows salience, not age: a whisper drowns while old loud lines stay", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  jevaary.memory.length = 0;
  for (let i = 0; i < 16; i += 1) storeMemory(world, jevaary, line(`big day ${i}`, { salience: 20 }));
  storeMemory(world, jevaary, line("a quiet aside", { salience: 1 }));
  assert.equal(jevaary.memory.length, 16, "the ring holds its cap");
  assert.ok(!jevaary.memory.some((item) => item.text === "a quiet aside"), "the whisper was evicted");
  assert.ok(
    jevaary.memory.some((item) => item.text === "big day 0"),
    "the oldest line survived — FIFO shifting is gone",
  );
});

test("a faded old line evicts before fresh ones", () => {
  const world = createWorld();
  const jevine = person(world, "jevine");
  jevine.memory.length = 0;
  // Two in-world days of fade leave a fifth of the weight; this one is nearly gone.
  storeMemory(world, jevine, line("old promise", { salience: 5, at: world.tick - 2500 }));
  for (let i = 0; i < 15; i += 1) storeMemory(world, jevine, line(`recent ${i}`, { salience: 10, at: world.tick }));
  storeMemory(world, jevine, line("the newest", { salience: 10, at: world.tick }));
  assert.ok(!jevine.memory.some((item) => item.text === "old promise"), "the faded line went first");
  assert.ok(jevine.memory.some((item) => item.text === "the newest"), "the fresh arrival stayed");
});

test("fade bottoms out at a fifth of the original weight", () => {
  const ancient = line("before the well", { salience: 4, at: -100_000 });
  assert.ok(Math.abs(fadedSalience(ancient, 0) - 0.8) < 1e-9);
});

// ---------------------------------------------------------------- beliefs

test("dawn consolidation folds repeated kindnesses into one belief and frees the ring", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  jevaary.memory.length = 0;
  for (const text of [
    "Jevine helped with the roof.",
    "Jevine shared berries.",
    "Jevine mended the fence.",
  ]) {
    storeMemory(world, jevaary, line(text, { about: "jevine", polarity: 1, salience: 10 }));
  }
  consolidate(world, jevaary, () => assert.fail("no slight here"));
  const belief = jevaary.beliefs?.find((item) => item.about === "jevine");
  assert.ok(belief, "the kindnesses became a belief");
  assert.equal(belief.count, 3);
  assert.match(belief.text, /Jevine: 3 kindnesses remembered\./);
  assert.ok(!jevaary.memory.some((item) => item.about === "jevine"), "the folded episodes left the ring");

  // More of the same later refreshes the standing belief instead of a second line.
  storeMemory(world, jevaary, line("Jevine carried water.", { about: "jevine", polarity: 1, salience: 10 }));
  storeMemory(world, jevaary, line("Jevine kept watch.", { about: "jevine", polarity: 1, salience: 10 }));
  consolidate(world, jevaary, () => assert.fail("no slight here"));
  const again = jevaary.beliefs?.find((item) => item.about === "jevine");
  assert.equal(again?.count, 5);
});

test("repeated slights fold into a slights belief and fire the bond callback", () => {
  const world = createWorld();
  const jevoss = person(world, "jevoss");
  jevoss.memory.length = 0;
  storeMemory(world, jevoss, line("Jevon mocked the harvest.", { about: "jevon", polarity: -1, salience: 9 }));
  storeMemory(world, jevoss, line("Jevon took the last cart.", { about: "jevon", polarity: -1, salience: 9 }));
  const slights: string[] = [];
  consolidate(world, jevoss, (aboutId) => slights.push(aboutId));
  const belief = jevoss.beliefs?.find((item) => item.about === "jevon" && item.polarity === -1);
  assert.ok(belief, "the slights became a belief");
  assert.match(belief.text, /slights remembered/);
  assert.deepEqual(slights, ["jevon"], "the callback named the offender once");
});

// ---------------------------------------------------------------- broken promises

test("a favor past two days fades unkept: both remember, the bond sours, the owe clears", () => {
  const world = createWorld();
  const debtor = person(world, "jevoss");
  const creditor = person(world, "jevaary");
  debtor.owe = { toId: creditor.id, item: "wood", qty: 2, at: world.tick - 3000 };

  deliverDialogue(world);

  assert.equal(debtor.owe ?? null, null, "the stale favor cleared");
  assert.ok(
    creditor.memory.some((item) => item.polarity === -1 && item.about === debtor.id),
    "the creditor holds the slight",
  );
  assert.ok(
    debtor.memory.some((item) => item.polarity === -1 && item.about === creditor.id && item.private),
    "the debtor carries the private weight",
  );
  const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(debtor.id, creditor.id));
  assert.ok((bond?.rivalry ?? 0) >= 3, "the souring reached the bond");
  assert.ok(world.log.some((event) => /faded unkept/.test(event.text)), "the town log noted it");
});

// ---------------------------------------------------------------- recall

test("recall ranks relevance over recency: who stands here beats a louder line", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  jevaary.memory.length = 0;
  storeMemory(world, jevaary, line("Jevon owes a debt of grain.", { about: "jevon", polarity: -1, salience: 4, at: world.tick }));
  storeMemory(world, jevaary, line("Rain came to the field.", { salience: 12, at: world.tick }));
  const recalled = recallFor(world, jevaary, { nearby: ["jevon"] });
  assert.equal(recalled[0]?.text, "Jevon owes a debt of grain.", "the person present pulls their line up");
});

test("recall also follows the current task's words", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  jevaary.memory.length = 0;
  storeMemory(world, jevaary, line("Jevon owes a debt of grain.", { about: "jevon", polarity: -1, salience: 4, at: world.tick }));
  storeMemory(world, jevaary, line("Rain came to the field.", { salience: 12, at: world.tick }));
  storeMemory(world, jevaary, line("Mend the fence by the well.", { salience: 2, at: world.tick }));
  const recalled = recallFor(world, jevaary, { task: "go mend the fence" });
  assert.equal(recalled[0]?.text, "Mend the fence by the well.", "task words surface the matching line");
});

test("recall returns three by default and orders by score", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  jevaary.memory.length = 0;
  for (let i = 0; i < 10; i += 1) storeMemory(world, jevaary, line(`note ${i}`, { salience: 5 + i, at: world.tick }));
  const recalled = recallFor(world, jevaary, {});
  assert.equal(recalled.length, 3);
  assert.equal(recalled[0]?.text, "note 9", "the strongest line leads");
  assert.equal(recallFor(world, jevaary, { limit: 5 }).length, 5);
});

// ---------------------------------------------------------------- prompts

test("the spine prompt shows the relevant line even when newer noise exists", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  const jevora = person(world, "jevora");
  jevaary.memory.length = 0;
  // Old and quiet, but about the person standing right here.
  storeMemory(
    world,
    jevaary,
    line("Jevora broke the water jar.", { about: "jevora", polarity: -1, salience: 4, at: world.tick - 2000 }),
  );
  for (let i = 0; i < 5; i += 1) storeMemory(world, jevaary, line(`chore note ${i}`, { salience: 3, at: world.tick }));
  jevora.x = jevaary.x + 1;
  jevora.y = jevaary.y;

  const { state } = buildQuestions(world, ["jevaary"]);
  assert.match(
    state,
    /Jevora broke the water jar\./,
    "the relevant line rides the prompt despite five newer notes",
  );
  assert.ok(
    !state.includes("chore note 4"),
    "only two of the five ties fit beside the winner — the rest stay out",
  );
});
