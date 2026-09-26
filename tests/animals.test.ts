import assert from "node:assert/strict";
import test from "node:test";
import { beastTick, legalMovesFor, type BeastConfig, type PostBeast } from "../src/server/beasts.js";
import { spawnAnimals, tickAnimals } from "../src/world/animals.js";
import { createWorld, setClock, snapshot, tick } from "../src/world/sim.js";
import type { Animal, Person, World } from "../src/world/types.js";
import { GRID_H, GRID_W } from "../src/world/types.js";

function animal(world: World, id: string): Animal {
  const found = world.animals.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

/** Fresh lookup so the compiler's null-narrowing from `step = null` above can't stick. */
function stepOf(world: World, id: string): Animal["step"] {
  return animal(world, id).step;
}

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

/** Push everyone far from the wildlife so fear never muddies a test. */
function sendPeopleAway(world: World): void {
  for (const item of world.people) {
    item.x = 92;
    item.y = 8;
  }
}

function ripeBerry(world: World) {
  const node = world.nodes.find((item) => item.kind === "berry" && item.stage >= item.maxStage);
  if (!node) throw new Error("no ripe berry bush in the seed");
  return node;
}

test("the valley spawns its wildlife: three crows, two deer, one dog, on the map", () => {
  const world = createWorld();
  assert.equal(world.animals.length, 6);
  const kinds = world.animals.map((item) => item.kind);
  assert.equal(kinds.filter((kind) => kind === "crow").length, 3);
  assert.equal(kinds.filter((kind) => kind === "deer").length, 2);
  assert.equal(kinds.filter((kind) => kind === "dog").length, 1);
  for (const item of world.animals) {
    assert.ok(item.x >= 3 && item.x <= GRID_W - 3);
    assert.ok(item.y >= 5 && item.y <= GRID_H - 5);
  }
  const snapshotState = snapshot(world, new Set());
  assert.equal(snapshotState.animals.length, 6, "the public state carries the wildlife");
  assert.ok(snapshotState.beast, "the public state carries the beast chip");
});

test("a hungry crow finds a ripe bush and strips a stage from it", () => {
  const world = createWorld();
  sendPeopleAway(world);
  setClock(world, 12, 0);
  const bush = ripeBerry(world);
  const crow = animal(world, "crow-0");
  crow.x = bush.x + 2;
  crow.y = bush.y;
  crow.hunger = 80;
  crow.fear = 0;
  crow.step = null;
  const stageBefore = bush.stage;

  for (let i = 0; i < 30 && bush.stage === stageBefore; i += 1) tick(world, "reflex");

  assert.ok(bush.stage < stageBefore, "the bush lost a stage to the crow");
  assert.ok(crow.hunger < 80, "the crow ate");
});

test("a frightened deer flees and gains distance", () => {
  const world = createWorld();
  setClock(world, 12, 0);
  const deer = animal(world, "deer-0");
  const near = person(world, "jevaary");
  deer.x = near.x + 2;
  deer.y = near.y;
  deer.fear = 40;
  deer.step = null;
  const before = Math.hypot(deer.x - near.x, deer.y - near.y);

  tick(world, "reflex");

  assert.equal(stepOf(world, "deer-0")?.kind, "flee");
  const after = Math.hypot(deer.x - near.x, deer.y - near.y);
  assert.ok(after > before, "the deer put ground between itself and the person");
});

test("the dog tags along with the nearest adult", () => {
  const world = createWorld();
  sendPeopleAway(world);
  setClock(world, 12, 0);
  const dog = animal(world, "dog-0");
  const friend = person(world, "jevaary");
  friend.x = 40;
  friend.y = 40;
  dog.x = 44;
  dog.y = 40;
  dog.fear = 0;
  dog.step = null;

  tick(world, "reflex");

  assert.equal(stepOf(world, "dog-0")?.kind, "follow");
  assert.equal(stepOf(world, "dog-0")?.personId, "jevaary");
});

test("night settles the wildlife down", () => {
  const world = createWorld();
  setClock(world, 23, 30);
  for (const item of world.animals) {
    item.step = null;
    item.fear = 0;
  }
  const crow = animal(world, "crow-0");
  const x = crow.x;

  tick(world, "reflex");

  assert.equal(stepOf(world, "crow-0")?.kind, "rest");
  assert.equal(crow.x, x, "a resting crow does not drift");
});

test("a laya urge bends a body only when legal for its kind", () => {
  const world = createWorld();
  sendPeopleAway(world);
  setClock(world, 12, 0);

  const deer = animal(world, "deer-0");
  deer.hunger = 10;
  deer.step = null;
  deer.bias = { kind: "graze", untilTick: world.tick + 30 };
  tick(world, "reflex");
  assert.equal(stepOf(world, "deer-0")?.kind, "graze", "a legal urge overrides the instinct even when unhungry");

  const crow = animal(world, "crow-0");
  crow.step = null;
  crow.bias = { kind: "graze", untilTick: world.tick + 30 };
  tick(world, "reflex");
  assert.notEqual(stepOf(world, "crow-0")?.kind, "graze", "a crow cannot graze — the instinct decides instead");
});

test("beastTick books a legal urge, drops an illegal one, and survives an unreachable laya", async () => {
  const world = createWorld();
  const config: BeastConfig = { baseUrl: "http://127.0.0.1:9", model: "jev-latest", apiKey: null };

  // A reply that asks the crow to steal (legal) and the deer to steal (not a deer thing).
  const post: PostBeast = async () => ({
    answers: {
      "q_crow-0_move": { choice: "steal" },
      "q_deer-0_move": { choice: "steal" },
      "q_crow-1_move": { choice: "fly to the moon" },
    },
  });
  await beastTick(world, config, post);
  assert.equal(world.beast.status, "ready");
  assert.equal(world.beast.calls, 1);
  assert.equal(animal(world, "crow-0").bias?.kind, "steal", "the legal urge landed");
  assert.equal(animal(world, "deer-0").bias, null, "an off-species move was dropped");
  assert.equal(animal(world, "crow-1").bias, null, "a nonsense move was dropped");

  // Unreachable laya: the mind errors, the bodies keep living by instinct.
  const failing: PostBeast = async () => {
    throw new Error("connect ECONNREFUSED");
  };
  await beastTick(world, config, failing);
  assert.equal(world.beast.status, "error");
  assert.match(world.beast.lastError ?? "", /ECONNREFUSED/);
  const before = world.animals.map((item) => ({ x: item.x, y: item.y }));
  tick(world, "reflex");
  const moved = world.animals.some((item, index) => item.x !== before[index]?.x || item.y !== before[index]?.y);
  assert.ok(moved || world.animals.every((item) => item.step?.kind === "rest"), "the wildlife moves without the mind");
});

test("beastTick with no config is a no-op and legality mirrors the bodies", async () => {
  const world = createWorld();
  world.beast.status = "off";
  await beastTick(world, null);
  assert.equal(world.beast.status, "off");
  assert.deepEqual(legalMovesFor("crow"), ["wander", "steal", "flee", "rest"]);
  assert.deepEqual(legalMovesFor("deer"), ["wander", "graze", "flee", "rest"]);
  assert.deepEqual(legalMovesFor("dog"), ["wander", "follow", "flee", "rest"]);
});

test("spawnAnimals is safe to call again and ids stay unique", () => {
  const world = createWorld();
  const again = spawnAnimals(world);
  assert.equal(again.length, 6);
  const ids = new Set(world.animals.map((item) => item.id));
  assert.equal(ids.size, world.animals.length);
});
