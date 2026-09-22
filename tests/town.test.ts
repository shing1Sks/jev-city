import assert from "node:assert/strict";
import test from "node:test";
import { createWorld, say, setClock, tick } from "../src/world/sim.js";
import { legalActions } from "../src/world/rules.js";
import { pathTo } from "../src/world/map.js";
import { allowedIntentIds } from "../src/world/lexicon.js";

function person(world: ReturnType<typeof createWorld>, id: string) {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

test("the town has eighteen named residents", () => {
  const world = createWorld();
  assert.equal(world.people.length, 18);
  assert.ok(world.people.some((item) => item.name === "Jevaary"));
  assert.ok(world.people.some((item) => item.name === "Jevine"));
  assert.equal(person(world, "jevik").band, "toddler");
  assert.equal(person(world, "jevoric").band, "elder");
  assert.equal(person(world, "jevina").band, "youth");
});

test("a toddler cannot farm or walk off alone", () => {
  const world = createWorld();
  const jevik = person(world, "jevik");
  const kinds = legalActions(jevik, world).map((action) => action.kind);
  assert.equal(kinds.includes("farm"), false);
  assert.equal(kinds.includes("go"), false);
  jevik.place = "field";
  assert.deepEqual(legalActions(jevik, world).map((action) => action.id), ["cry"]);
});

test("a child out at night may only go home", () => {
  const world = createWorld();
  setClock(world, 20, 10);
  const jevlin = person(world, "jevlin");
  jevlin.place = "field";
  assert.deepEqual(legalActions(jevlin, world).map((action) => action.id), ["go_vale"]);
});

test("an elder does not haul or farm", () => {
  const world = createWorld();
  const jevoric = person(world, "jevoric");
  jevoric.place = "field";
  jevoric.energy = 90;
  const kinds = legalActions(jevoric, world).map((action) => action.kind);
  assert.equal(kinds.includes("haul"), false);
  assert.equal(kinds.includes("farm"), false);
});

test("toddler speech is a small lexicon", () => {
  assert.equal(allowedIntentIds("toddler").includes("tell"), false);
  assert.equal(allowedIntentIds("adult").includes("tell"), true);
});

test("the grove reaches the elder porch", () => {
  const path = pathTo("grove", "porch");
  assert.ok(path.length >= 3);
  assert.equal(path.at(-1), "porch");
});

test("private speech is heard only by the pair", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  const jevine = person(world, "jevine");
  const jevella = person(world, "jevella");
  jevaary.place = "square";
  jevine.place = "square";
  jevella.place = "square";
  say(world, jevaary, "private", "jevine", "NEED food 🍽️");
  assert.equal(jevine.memory.some((line) => line.text.includes("NEED food")), true);
  assert.equal(jevella.memory.length, 0);
  assert.deepEqual(world.log.at(-1)?.heardBy, ["jevine"]);
});

test("an announcement is heard by the whole town", () => {
  const world = createWorld();
  const jevoric = person(world, "jevoric");
  jevoric.place = "square";
  say(world, jevoric, "town", null, "TELL rain 🌧️");
  assert.equal(world.log.at(-1)?.heardBy.length, world.people.length - 1);
});

test("night brings the toddler home", () => {
  const world = createWorld();
  setClock(world, 18, 50);
  const jevik = person(world, "jevik");
  jevik.place = "field";
  for (let step = 0; step < 40; step += 1) tick(world, "reflex");
  assert.equal(jevik.place, "market");
  assert.equal(jevik.distress, false);
});

test("a day of reflex keeps stores and bodies in range", () => {
  const world = createWorld();
  for (let step = 0; step < 30; step += 1) tick(world, "reflex");
  for (const amount of Object.values(world.food)) assert.ok(amount >= 0);
  for (const resident of world.people) {
    assert.ok(resident.hunger >= 0 && resident.hunger <= 100);
    assert.ok(resident.energy >= 0 && resident.energy <= 100);
  }
});
