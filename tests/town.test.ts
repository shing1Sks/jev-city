import assert from "node:assert/strict";
import test from "node:test";
import { allowedIntentIds } from "../src/world/lexicon.js";
import { centerOf } from "../src/world/map.js";
import { reflexDecide } from "../src/world/reflex.js";
import { legalSteps } from "../src/world/rules.js";
import { createWorld, say, setClock, tick } from "../src/world/sim.js";
import type { Person, World } from "../src/world/types.js";
import { dist } from "../src/world/types.js";

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function standTogether(world: World, ids: string[], at: { x: number; y: number }): void {
  for (const id of ids) {
    const someone = person(world, id);
    someone.x = at.x + 0.4;
    someone.y = at.y + 0.3;
  }
}

test("the town has eighteen residents across the six households", () => {
  const world = createWorld();
  assert.equal(world.people.length, 18);
  assert.equal(person(world, "jevik").band, "toddler");
  assert.equal(person(world, "jevlin").band, "child");
  assert.equal(person(world, "jevina").band, "youth");
  assert.equal(person(world, "jevaary").band, "adult");
  assert.equal(person(world, "jevoric").band, "elder");
  assert.equal(new Set(world.people.map((someone) => someone.household)).size, 6);
  assert.equal(Object.keys(world.storages).length, 6);
});

test("everyone starts home, on open ground", () => {
  const world = createWorld();
  for (const someone of world.people) {
    const home = centerOf(someone.home);
    assert.ok(dist(someone, home) <= 8, `${someone.id} near ${someone.home}`);
  }
});

test("toddler speech is a small lexicon", () => {
  assert.equal(allowedIntentIds("toddler").includes("tell"), false);
  assert.equal(allowedIntentIds("adult").includes("tell"), true);
});

test("the reflex only ever chooses from the legal step list", () => {
  const world = createWorld();
  setClock(world, 11, 0);
  for (const someone of world.people) {
    const decision = reflexDecide(world, someone.id);
    const allowed = legalSteps(someone, world);
    assert.ok(
      allowed.some((option) => option.id === decision.stepId),
      `${someone.id}: ${decision.stepId} is legal`,
    );
  }
});

test("private speech is heard only by the pair", () => {
  const world = createWorld();
  standTogether(world, ["jevaary", "jevine", "jevella"], centerOf("square"));
  const jevaary = person(world, "jevaary");
  const jevine = person(world, "jevine");
  say(world, jevaary, "private", "jevine", "NEED food 🍽️");
  assert.ok(jevine.memory.some((line) => line.text.includes("NEED food")));
  assert.equal(person(world, "jevella").memory.length, 0);
  assert.deepEqual(world.log.at(-1)?.heardBy, ["jevine"]);
});

test("an announcement from the square is heard by the whole town", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  jevaary.x = centerOf("square").x;
  jevaary.y = centerOf("square").y;
  say(world, jevaary, "town", null, "TELL rain 🌧️");
  assert.equal(world.log.at(-1)?.heardBy.length, world.people.length - 1);
});

test("a private word to that person deepens the tie", () => {
  const world = createWorld();
  standTogether(world, ["jevaary", "jevine"], centerOf("grove"));
  const jevaary = person(world, "jevaary");
  const jevine = person(world, "jevine");
  jevaary.matter = { withId: "jevine", kind: "court", step: 0 };
  const findBond = () =>
    world.bonds.find((bond) => (bond.a === "jevaary" && bond.b === "jevine") || (bond.a === "jevine" && bond.b === "jevaary"));
  const love = findBond()?.love ?? 0;
  say(world, jevaary, "private", "jevine", "LIKE friend ❤️");
  assert.equal(jevaary.matter?.step, 1);
  assert.ok((findBond()?.love ?? 0) > love);
  assert.match(findBond()?.note ?? "", /closer/);
});

test("night pulls the young home and keeps them there", () => {
  const world = createWorld();
  setClock(world, 20, 30);
  const jevlin = person(world, "jevlin");
  jevlin.x = 25;
  jevlin.y = 30;
  const homeward = (someone: Person) =>
    someone.step?.kind === "walk" && Boolean(someone.step.dest) && dist(someone.step.dest ?? someone, centerOf(someone.home)) < 3;
  let steps = 0;
  for (; steps < 500 && world.phase === "night"; steps += 1) {
    tick(world, "reflex");
    for (const someone of world.people) {
      if (someone.band !== "child" && someone.band !== "youth") continue;
      const home = centerOf(someone.home);
      const porch = centerOf("porch");
      const safe = dist(someone, home) <= 10 || dist(someone, porch) <= 10 || homeward(someone);
      assert.ok(safe, `${someone.id} out at night (${someone.x.toFixed(1)}, ${someone.y.toFixed(1)})`);
    }
  }
  assert.ok(steps > 100, "the night lasted");
  assert.ok(dist(jevlin, centerOf("vale")) <= 10, "the stray child walked home under curfew");
});
