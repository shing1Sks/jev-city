import assert from "node:assert/strict";
import test from "node:test";
import { applyBrain } from "../src/server/brain.js";
import { centerOf } from "../src/world/map.js";
import { capableMember, forcedStep } from "../src/world/rules.js";
import { createWorld, dawnHealth, gatherFestival, queueDialogue, setClock, stormPass, tick, townCeremony } from "../src/world/sim.js";
import type { Person, World } from "../src/world/types.js";

function person(world: World, id: string): Person {
  const found = world.people.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

// ---------------------------------------------------------------- ceremonies

test("a town ceremony reaches every living ear and warms the town", () => {
  const world = createWorld();
  const alive = world.people.filter((item) => item.alive);
  const before = new Map(alive.map((item) => [item.id, item.belonging]));
  const uncompiledBefore = world.uncompiled;

  townCeremony(world, "The town gathers for the first fire of autumn.", "life", 5);

  const event = world.log[world.log.length - 1];
  assert.match(event?.text ?? "", /first fire/);
  assert.equal(event?.kind, "life");
  assert.equal(event?.place, "square");
  assert.equal(event?.audience, "town");
  assert.deepEqual(event?.heardBy, alive.map((item) => item.id));
  for (const item of alive) {
    assert.equal(item.belonging, Math.min(100, (before.get(item.id) ?? 0) + 5));
  }
  assert.equal(world.uncompiled, uncompiledBefore + 1);

  // A cold ceremony is heard but moves no hearts; a vigil cools them, floored at zero.
  const held = alive.map((item) => item.belonging);
  townCeremony(world, "A dry proclamation.", "law", 0);
  assert.deepEqual(alive.map((item) => item.belonging), held);
  townCeremony(world, "A vigil is held at the well.", "life", -4);
  for (const item of alive) {
    assert.equal(item.belonging, Math.max(0, (held[alive.indexOf(item)] ?? 0) - 4));
  }
});

// ---------------------------------------------------------------- storm

test("a storm fells a live tree and shares the windfall with every household", () => {
  const world = createWorld();
  const liveTrees = world.nodes.filter((node) => node.kind === "tree" && node.stage > 0);
  assert.ok(liveTrees.length > 0, "the seed plants trees");
  const woodBefore = new Map(Object.entries(world.storages).map(([key, store]) => [key, store.wood]));

  stormPass(world);

  const felled = world.nodes.find((node) => node.kind === "tree" && node.stage === 0);
  assert.ok(felled, "a tree was felled");
  assert.equal(felled?.growAt, null, "a stump does not regrow on its own");
  for (const [key, store] of Object.entries(world.storages)) {
    assert.equal(store.wood, (woodBefore.get(key) ?? 0) + 2, `${key} gathered the windfall`);
  }
  const event = world.log[world.log.length - 1];
  assert.match(event?.text ?? "", /windfall/);
  assert.equal(event?.kind, "weather");
});

// ---------------------------------------------------------------- illness

test("the ill keep to home and rest, unless hunger sends them for food", () => {
  const world = createWorld();
  setClock(world, 12, 0);
  const sick = person(world, "jevoss");
  sick.ill = { since: world.tick };
  sick.hunger = 40;
  const home = centerOf(sick.home);

  // At home: the law holds them still.
  sick.x = home.x;
  sick.y = home.y;
  const rest = forcedStep(sick, world);
  assert.equal(rest?.id, "rest");
  assert.equal(rest?.kind, "rest");

  // Away: the law walks them home first.
  sick.x = home.x + 30;
  sick.y = home.y + 30;
  const go = forcedStep(sick, world);
  assert.equal(go?.id, "go_home");
  assert.equal(go?.kind, "walk");

  // Starving: hunger wins over rest, so the ill can still reach the pantry.
  sick.x = home.x;
  sick.y = home.y;
  sick.hunger = 90;
  assert.equal(forcedStep(sick, world), null);
});

test("comfort from a friend ends an illness", () => {
  const world = createWorld();
  const speaker = person(world, "jevoss");
  const listener = person(world, "jevaary");
  speaker.x = 40;
  speaker.y = 40;
  listener.x = 41;
  listener.y = 40;
  listener.ill = { since: world.tick };

  queueDialogue(world, speaker.id, listener.id, { kind: "comfort" }, "Rest now. I will sit with you.");
  tick(world, "reflex");

  assert.equal(listener.ill, null, "the comfort cured them");
  assert.ok(
    world.log.some((event) => new RegExp(`${listener.name}, comforted by ${speaker.name}`).test(event.text)),
    "the recovery entered the town log",
  );
});

test("dawnHealth: long illness passes on its own, and no one sickens while someone is ill", () => {
  const world = createWorld();
  const sick = person(world, "jevaary");
  sick.ill = { since: world.tick - 3000 };

  dawnHealth(world);

  // The old illness is logged off. The same dawn may hand her a fresh one —
  // the gate rolls after the sweep — so only the log proves the recovery.
  assert.ok(world.log.some((event) => /well again after days of illness/.test(event.text)));

  // Force the 18% spawn gate across seeds until someone falls ill.
  let cameDown: Person | null = null;
  for (let seed = 1; seed < 6000 && !cameDown; seed += 1) {
    for (const item of world.people) item.ill = null;
    world.rng = seed;
    dawnHealth(world);
    cameDown = world.people.find((item) => item.alive && item.ill) ?? null;
  }
  assert.ok(cameDown, "given enough dawns, someone falls ill");
  assert.ok(cameDown?.band === "adult" || cameDown?.band === "elder", "only the grown take to bed");

  // While someone is ill, no second illness spawns even on a lucky roll.
  const illCount = world.people.filter((item) => item.alive && item.ill).length;
  for (let seed = 1; seed < 200; seed += 1) {
    world.rng = seed;
    dawnHealth(world);
    assert.equal(world.people.filter((item) => item.alive && item.ill).length, illCount);
  }
});

// ---------------------------------------------------------------- festivals

test("a finished build calls every capable hand to the square", () => {
  const world = createWorld();
  const alive = world.people.filter((item) => item.alive);
  const before = new Map(alive.map((item) => [item.id, item.belonging]));

  gatherFestival(world, "the north orchard", "Jevoss");

  for (const item of alive) {
    if (capableMember(item)) {
      assert.equal(item.invite?.place, "square", `${item.name} was invited`);
      assert.equal(item.invite?.untilTick, world.tick + 120);
    } else {
      assert.equal(item.invite?.place ?? null, null, `${item.name} stays home`);
    }
  }
  const event = world.log[world.log.length - 1];
  assert.match(event?.text ?? "", /north orchard stands finished/);
  assert.match(event?.text ?? "", /Jevoss raised it stage by stage/);
  assert.equal(event?.kind, "build");
  for (const item of alive) {
    assert.ok(item.belonging > (before.get(item.id) ?? 0), "a festival warms the town");
  }
});

// ---------------------------------------------------------------- rites

test("the naming rite lands through the brain and warms the guardians", () => {
  const world = createWorld();
  const baby = person(world, "jevik");
  world.pendingNames.push(baby.id);
  const guardians = baby.guardians
    .map((id) => world.people.find((item) => item.id === id))
    .filter((item): item is Person => Boolean(item?.alive));
  assert.ok(guardians.length > 0, "the baby has living guardians");
  const guardianBefore = new Map(guardians.map((item) => [item.id, item.belonging]));
  const uncompiledBefore = world.uncompiled;

  const dropped = applyBrain(
    world,
    ["jevoss"],
    JSON.stringify({
      agents: [{ id: "jevoss", task: null, thought: "", memory: "" }],
      dialogue: [],
      names: [{ baby: baby.id, name: "Luma", meaning: "born at first light" }],
    }),
  );

  assert.equal(dropped, 0);
  assert.equal(baby.name, "Luma");
  assert.equal(world.pendingNames.length, 0);
  const event = world.log[world.log.length - 1];
  assert.match(event?.text ?? "", /The town names the newborn Luma/);
  assert.match(event?.text ?? "", /born at first light/);
  assert.equal(event?.heardBy.length, world.people.filter((item) => item.alive).length);
  for (const guardian of guardians) {
    assert.equal(guardian.belonging, (guardianBefore.get(guardian.id) ?? 0) + 8, "the rite warms the parents");
  }
  assert.equal(world.uncompiled, uncompiledBefore + 1);
});

test("a death is met with a town vigil", () => {
  const world = createWorld();
  const elder = world.people.find((item) => item.alive && item.band === "elder") ?? person(world, "jevoss");
  elder.age = 95;
  elder.band = "elder";
  setClock(world, 23, 59);

  tick(world, "reflex"); // the day flips; ageAndLife runs

  assert.equal(elder.alive, false);
  assert.ok(world.log.some((event) => new RegExp(`keeps a vigil for ${elder.name}`).test(event.text)));
});
