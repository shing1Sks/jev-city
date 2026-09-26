import assert from "node:assert/strict";
import test from "node:test";
import { placeOf } from "../src/world/map.js";
import { bondKey } from "../src/world/types.js";
import type { Person, World } from "../src/world/types.js";
import { createWorld, tick } from "../src/world/sim.js";
import { tradeAtStalls } from "../src/world/trade.js";

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

/** Everyone else is sent far away so only the staged pair stands at a trade spot. */
function sendOthersAway(world: World): void {
  for (const item of world.people) {
    if (item.id === "jevoss" || item.id === "jevaary") continue;
    item.x = 92;
    item.y = 8;
  }
}

/** Two traders from different households, parked at a spot, with given stores. */
function stageTraders(world: World, at: { x: number; y: number }, aStore: Partial<Record<string, number>>, bStore: Partial<Record<string, number>>): { a: Person; b: Person } {
  const a = person(world, "jevoss");
  const b = person(world, "jevaary");
  a.household = "trade-a";
  b.household = "trade-b";
  world.storages["trade-a"] = { wood: 0, stone: 0, grain: 0, berries: 0, cloth: 0, ...aStore };
  world.storages["trade-b"] = { wood: 0, stone: 0, grain: 0, berries: 0, cloth: 0, ...bStore };
  for (const item of [a, b]) {
    item.x = at.x;
    item.y = at.y;
    item.step = null;
    item.ill = null;
  }
  sendOthersAway(world);
  return { a, b };
}

function bondOf(world: World, a: string, b: string): number {
  return world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(a, b))?.score ?? 0;
}

test("complementary stores trade at the market, and the scene lands", () => {
  const world = createWorld();
  const market = placeOf("market");
  const { a, b } = stageTraders(
    world,
    { x: market.x, y: market.y },
    { grain: 6 },
    { cloth: 6 },
  );
  const bondBefore = bondOf(world, a.id, b.id);
  const aBelonging = a.belonging;
  const bBelonging = b.belonging;
  const logBefore = world.log.length;
  const uncompiledBefore = world.uncompiled;

  tradeAtStalls(world);

  const sa = world.storages["trade-a"];
  const sb = world.storages["trade-b"];
  assert.equal(sa?.grain, 4, "a sent 2 grain");
  assert.equal(sa?.cloth, 2, "a took 2 cloth");
  assert.equal(sb?.grain, 2, "b took 2 grain");
  assert.equal(sb?.cloth, 4, "b sent 2 cloth");
  const event = world.log[world.log.length - 1];
  assert.match(event?.text ?? "", /trade 2 (grain for 2 cloth|cloth for 2 grain) at the market/);
  assert.ok(world.log.length > logBefore);
  assert.equal(world.uncompiled, uncompiledBefore + 1);
  assert.ok(a.speech, "the trader speaks the bargain");
  assert.ok(a.memory.some((line) => /Traded 2 grain for 2 cloth with/.test(line.text)));
  assert.ok(b.memory.some((line) => /Traded 2 cloth for 2 grain with/.test(line.text)));
  assert.equal(bondOf(world, a.id, b.id), Math.min(100, bondBefore + 3), "a fair trade warms the bond");
  assert.equal(a.belonging, Math.min(100, aBelonging + 1), "trading warms the trader");
  assert.equal(b.belonging, Math.min(100, bBelonging + 1), "and the traded-with");
});

test("no trade when the stores do not complement", () => {
  const world = createWorld();
  const market = placeOf("market");
  stageTraders(world, { x: market.x, y: market.y }, { grain: 8 }, { grain: 8 });
  const before = JSON.stringify(world.storages["trade-a"]);
  const logBefore = world.log.length;

  tradeAtStalls(world);

  assert.equal(JSON.stringify(world.storages["trade-a"]), before);
  assert.equal(world.log.length, logBefore);
});

test("no trade away from the market and stalls", () => {
  const world = createWorld();
  stageTraders(world, { x: 15, y: 15 }, { grain: 6 }, { cloth: 6 });
  const before = JSON.stringify(world.storages["trade-a"]);

  tradeAtStalls(world);

  assert.equal(JSON.stringify(world.storages["trade-a"]), before);
});

test("children do not trade, and a fresh swap does not immediately ping-pong", () => {
  const world = createWorld();
  const market = placeOf("market");
  const { a, b } = stageTraders(world, { x: market.x, y: market.y }, { grain: 6 }, { cloth: 6 });
  a.band = "child";

  tradeAtStalls(world);
  assert.equal(world.storages["trade-a"]?.cloth, 0, "a child does not close a deal");

  a.band = "adult";
  tradeAtStalls(world);
  assert.equal(world.storages["trade-a"]?.cloth, 2, "the grown-up closes it");

  // Each side now holds 2 of the received good — above the need line — so no
  // immediate reverse trade churns the same goods back.
  const grainA = world.storages["trade-a"]?.grain;
  const clothA = world.storages["trade-a"]?.cloth;
  tradeAtStalls(world);
  assert.equal(world.storages["trade-a"]?.grain, grainA);
  assert.equal(world.storages["trade-a"]?.cloth, clothA);
  assert.ok(b.speech, "b still carries the last word");
});

test("the tick sweep closes trades on its own while people stand at the market", () => {
  const world = createWorld();
  const market = placeOf("market");
  stageTraders(world, { x: market.x, y: market.y }, { grain: 6 }, { cloth: 6 });

  for (let i = 0; i < 25; i += 1) tick(world, "open");

  assert.equal(world.storages["trade-a"]?.grain, 4, "the sweep traded without anyone deciding to");
  assert.ok(world.log.some((event) => /trade 2 (grain for 2 cloth|cloth for 2 grain)/.test(event.text)));
});
