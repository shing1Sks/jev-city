import assert from "node:assert/strict";
import test from "node:test";
import { addToCarry, spendMeal, carryCount } from "../src/world/carry.js";
import { RECIPES, canMarkSite, deliverToSite, raiseStage, siteComplete, siteNeeds } from "../src/world/construction.js";
import { buildTerrain, findPath, regionAt, cellKey } from "../src/world/grid.js";
import { deplete, yieldOf } from "../src/world/nodes.js";
import { legalSteps, forcedStep } from "../src/world/rules.js";
import { applyDecision, createWorld, setClock, tick } from "../src/world/sim.js";
import type { Decision, Person, ResourceNode, Weather, World } from "../src/world/types.js";
import { carryCapacity, dist } from "../src/world/types.js";
import { nextWeather } from "../src/world/weather.js";

/** A hand-built decision so tests can drive the body exactly like the spine will. */
function decide(personId: string, stepId: string): Decision {
  return {
    personId,
    stepId,
    speak: false,
    audience: "here",
    listenerId: null,
    intentWord: "need",
    topic: "help",
    tone: "soft",
    because: "test",
    source: "reflex",
    confidence: null,
  };
}

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

/** Reads the live step; TypeScript cannot see applyDecision writing it back. */
function stepKind(someone: Person): string | null {
  return someone.step?.kind ?? null;
}

// ---------------------------------------------------------------- clock

test("1440 ticks make one in-world day", () => {
  const world = createWorld();
  assert.equal(world.hour, 7);
  for (let step = 0; step < 1440; step += 1) tick(world, "reflex");
  assert.equal(world.day, 2);
  assert.equal(world.hour, 7);
  assert.equal(world.minute, 0);
});

// ---------------------------------------------------------------- pathing

test("A* routes around a blocked wall instead of through it", () => {
  const terrain = buildTerrain();
  const blocked = new Uint8Array(100 * 100);
  for (let y = 30; y <= 70; y += 1) blocked[cellKey(50, y)] = 1;
  const path = findPath(terrain, blocked, { x: 40, y: 50 }, { x: 60, y: 50 });
  assert.ok(path);
  assert.ok(path.length >= 2, "a detour needs at least one bend");
  // Waypoints sit on cell centers (x.5), so floor gives the owning cell.
  for (const point of path) {
    assert.equal(blocked[cellKey(Math.floor(point.x), Math.floor(point.y))], 0);
  }
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    assert.ok(a && b);
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    for (let sample = 0; sample <= steps; sample += 1) {
      const t = sample / steps;
      const x = Math.floor(a.x + (b.x - a.x) * t);
      const y = Math.floor(a.y + (b.y - a.y) * t);
      assert.equal(blocked[cellKey(x, y)], 0, `leg ${index - 1}->${index} clips the wall`);
    }
  }
  const straight = findPath(terrain, blocked, { x: 40, y: 50 }, { x: 41, y: 50 });
  assert.ok(straight);
});

test("regionAt resolves a spot to its named region", () => {
  const world = createWorld();
  void world;
  assert.ok(regionAt({ x: 52, y: 56 }, 6));
});

test("a walk decision moves a person continuously toward the destination", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  jevaary.step = null;
  const square = { x: 52, y: 56 };
  jevaary.x = 20;
  jevaary.y = 20;
  const before = dist(jevaary, square);
  applyDecision(world, decide(jevaary.id, "walk_square"));
  assert.equal(stepKind(jevaary), "walk");
  for (let step = 0; step < 30; step += 1) tick(world, "open");
  assert.ok(dist(jevaary, square) < before, "closed the distance");
});

// ---------------------------------------------------------------- nodes and carry

test("chopping fills the hands and depletes the tree", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  const tree = world.nodes.find((node) => node.kind === "tree" && node.stage >= 3);
  assert.ok(tree, "the world scatters full trees");
  jevaary.x = tree.x - 2;
  jevaary.y = tree.y;
  const stageBefore = tree.stage;
  applyDecision(world, decide(jevaary.id, `chop_${tree.id}`));
  assert.equal(stepKind(jevaary), "chop");
  for (let step = 0; step < 80 && carryCount(jevaary.carry) === 0; step += 1) tick(world, "open");
  assert.ok((jevaary.carry.wood ?? 0) >= 1, "wood landed in the carry");
  assert.equal(tree.stage, stageBefore - 1);
  assert.ok(jevaary.skills.haul > 68, "the work taught the skill");
});

test("carry capacity caps what a band can hold", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  assert.equal(addToCarry(jevaary, "wood", 10), carryCapacity("adult"));
  const jevik = person(world, "jevik");
  assert.equal(addToCarry(jevik, "wood", 5), 0);
});

test("storing goods moves the carry into the household store", () => {
  const world = createWorld();
  const jevaary = person(world, "jevaary");
  const woodBefore = world.storages.vale?.wood ?? 0;
  addToCarry(jevaary, "wood", 3);
  jevaary.step = null;
  applyDecision(world, decide(jevaary.id, "store"));
  assert.ok(jevaary.step, "store began");
  for (let step = 0; step < 90 && carryCount(jevaary.carry) > 0; step += 1) tick(world, "open");
  assert.equal(carryCount(jevaary.carry), 0);
  assert.equal((world.storages.vale?.wood ?? 0) - woodBefore, 3);
});

test("a meal spends grain first, then pairs of berries", () => {
  assert.equal(spendMeal({ wood: 0, stone: 0, grain: 1, berries: 0, cloth: 0 }), true);
  const berries = { wood: 0, stone: 0, grain: 0, berries: 2, cloth: 0 };
  assert.equal(spendMeal(berries), true);
  assert.equal(berries.berries, 0);
  assert.equal(spendMeal({ wood: 0, stone: 0, grain: 0, berries: 1, cloth: 0 }), false);
});

test("yields and depletion match the node tables", () => {
  const tree: ResourceNode = { id: "t", kind: "tree", x: 0, y: 0, stage: 3, maxStage: 3, growAt: null };
  assert.deepEqual(yieldOf(tree), { item: "wood", qty: 2 });
  assert.equal(deplete(tree), true);
  assert.equal(tree.stage, 2);
  const bare: ResourceNode = { id: "b", kind: "rock", x: 0, y: 0, stage: 0, maxStage: 2, growAt: null };
  assert.equal(yieldOf(bare), null);
  assert.equal(deplete(bare), false);
});

// ---------------------------------------------------------------- construction

test("Jevoss starts with a marked house plot and a real recipe", () => {
  const world = createWorld();
  assert.equal(world.sites.length, 1);
  const site = world.sites[0];
  assert.ok(site);
  assert.equal(site.ownerId, "jevoss");
  assert.equal(site.kind, "house");
  assert.equal(site.stage, 0);
  assert.deepEqual(site.need, RECIPES.house?.need);
  assert.equal(canMarkSite("garden"), false);
});

test("materials delivered to a site raise it stage by stage to a building", () => {
  const world = createWorld();
  const jevoss = person(world, "jevoss");
  const site = world.sites[0];
  assert.ok(site);
  // Adult hands hold four units, so the house takes several trips.
  addToCarry(jevoss, "wood", 6);
  assert.deepEqual(deliverToSite(jevoss, site), [{ item: "wood", qty: 4 }]);
  jevoss.carry = {};
  addToCarry(jevoss, "wood", 6);
  assert.deepEqual(deliverToSite(jevoss, site), [{ item: "wood", qty: 2 }]);
  jevoss.carry = {};
  addToCarry(jevoss, "stone", 4);
  assert.deepEqual(deliverToSite(jevoss, site), [{ item: "stone", qty: 4 }]);
  assert.equal(siteNeeds(site), 0);
  assert.equal(raiseStage(site), true);
  assert.equal(raiseStage(site), true);
  assert.equal(raiseStage(site), true);
  assert.equal(siteComplete(site), true);
  assert.equal(raiseStage(site), false);
});

test("a finished build step turns the site into an expansion with a town event", () => {
  const world = createWorld();
  const jevoss = person(world, "jevoss");
  const site = world.sites[0];
  assert.ok(site);
  site.need = {};
  site.have = {};
  jevoss.x = site.x + 1.5;
  jevoss.y = site.y;
  jevoss.step = null;
  applyDecision(world, decide(jevoss.id, `build_${site.id}`));
  assert.equal(stepKind(jevoss), "build");
  for (let step = 0; step < 300 && !siteComplete(site); step += 1) {
    if (!jevoss.step) applyDecision(world, decide(jevoss.id, `build_${site.id}`));
    tick(world, "open");
  }
  assert.ok(siteComplete(site));
  const built = world.expansions.find((item) => item.ownerId === "jevoss");
  assert.equal(built?.kind, "house");
  assert.ok(world.log.some((event) => event.kind === "build" && event.text.includes("house")));
});

// ---------------------------------------------------------------- weather

test("weather stays inside its five states", () => {
  const rng = { rng: 777 };
  const legal: Weather[] = ["clear", "cloudy", "rain", "wind", "storm"];
  let current: Weather = "clear";
  for (let step = 0; step < 500; step += 1) {
    current = nextWeather(current, rng);
    assert.ok(legal.includes(current));
  }
});

// ---------------------------------------------------------------- law

test("a toddler never walks alone and cries when abandoned", () => {
  const world = createWorld();
  const jevik = person(world, "jevik");
  const kinds = legalSteps(jevik, world).map((option) => option.kind);
  assert.equal(kinds.includes("walk"), false);
  jevik.x = 5;
  jevik.y = 5;
  assert.equal(forcedStep(jevik, world)?.id, "cry");
  assert.deepEqual(legalSteps(jevik, world).map((option) => option.id), ["cry"]);
});

test("a child out at night may only go home", () => {
  const world = createWorld();
  setClock(world, 21, 0);
  const jevlin = person(world, "jevlin");
  const grove = { x: 20, y: 30 };
  jevlin.x = grove.x;
  jevlin.y = grove.y;
  assert.deepEqual(legalSteps(jevlin, world).map((option) => option.id), ["go_home"]);
});

test("an elder does not chop or mine", () => {
  const world = createWorld();
  const jevoric = person(world, "jevoric");
  const kinds = legalSteps(jevoric, world).map((option) => option.kind);
  assert.equal(kinds.includes("chop"), false);
  assert.equal(kinds.includes("mine"), false);
});

test("a youth may chop but never mine", () => {
  const world = createWorld();
  const jevina = person(world, "jevina");
  const options = legalSteps(jevina, world);
  assert.equal(options.some((option) => option.kind === "chop"), true);
  assert.equal(options.some((option) => option.kind === "mine"), false);
});

// ---------------------------------------------------------------- soak

test("two thousand ticks of reflex keep the world sane", () => {
  const world = createWorld();
  const woodBefore =
    Object.values(world.storages).reduce((sum, storage) => sum + storage.wood, 0) +
    world.people.reduce((sum, someone) => sum + (someone.carry.wood ?? 0), 0) +
    world.sites.reduce((sum, site) => sum + (site.have.wood ?? 0), 0);
  let sawMeal = false;
  for (let step = 0; step < 2000; step += 1) {
    tick(world, "reflex");
    if (world.log.some((event) => event.kind === "meal")) sawMeal = true;
  }
  for (const someone of world.people) {
    assert.ok(Number.isFinite(someone.x) && Number.isFinite(someone.y), `${someone.id} position`);
    assert.ok(someone.x >= 0 && someone.x <= 100 && someone.y >= 0 && someone.y <= 100, `${someone.id} on the map`);
    for (const [name, value] of [["hunger", someone.hunger], ["energy", someone.energy], ["belonging", someone.belonging]] as const) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 100, `${someone.id} ${name} ${value}`);
    }
  }
  for (const node of world.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.stage >= 0 && node.stage <= node.maxStage);
  }
  assert.ok(world.people.every((someone) => someone.alive), "nobody starved");
  assert.ok(sawMeal, "meals were eaten");
  const woodAfter =
    Object.values(world.storages).reduce((sum, storage) => sum + storage.wood, 0) +
    world.people.reduce((sum, someone) => sum + (someone.carry.wood ?? 0), 0) +
    world.sites.reduce((sum, site) => sum + (site.have.wood ?? 0), 0);
  assert.ok(woodAfter >= woodBefore - 6, `wood conserved (${woodBefore} -> ${woodAfter})`);
});
