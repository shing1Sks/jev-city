import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { createWorld } from "../src/world/sim.js";
import { parseVisitorTalk } from "../src/world/talk.js";
import { enterTown, stepVisitors, visitorSay } from "../src/server/visitors.js";

const folk = [
  { id: "jevaary", name: "Jevaary" },
  { id: "jevine", name: "Jevine" },
  { id: "jevoric", name: "Jevoric" },
];

function requestFrom(ip: string): IncomingMessage {
  return { headers: {}, socket: { remoteAddress: ip } } as IncomingMessage;
}

test("@all, @name, and @@ name up to three people", () => {
  const all = parseVisitorTalk("@all come to the well", folk);
  assert.equal(all.error, null);
  assert.equal(all.audience, "town");
  assert.equal(all.body, "come to the well");

  const one = parseVisitorTalk("@Jevaary the mill needs hands", folk);
  assert.deepEqual(one.ids, ["jevaary"]);
  assert.equal(one.audience, "direct");

  const three = parseVisitorTalk("@@ Jevaary Jevine Jevoric mend the gate", folk);
  assert.deepEqual(three.ids, ["jevaary", "jevine", "jevoric"]);
  assert.equal(three.body, "mend the gate");

  const extra = parseVisitorTalk("@@ Jevaary Jevine Jevoric Jevaary wait", folk);
  assert.equal(extra.ids.length, 3);
  assert.equal(extra.body, "Jevaary wait");

  const suggest = parseVisitorTalk("suggest @all plant the grove", folk);
  assert.equal(suggest.suggest, true);
  assert.equal(suggest.audience, "town");
  assert.equal(suggest.body, "plant the grove");

  const bare = parseVisitorTalk("hello there", folk);
  assert.equal(bare.error, "Start with @all, @Name, or @@ Name Name Name.");
});

test("one address can bring in ten visitors and no eleventh", async () => {
  const world = createWorld();
  const request = requestFrom("203.0.113.9");
  const names = ["Ana", "Ben", "Cara", "Dan", "Eve", "Fay", "Gil", "Hua", "Ian", "Joy"];
  for (const guest of names) {
    const result = await enterTown(world, request, guest);
    assert.equal("error" in result, false);
  }
  const blocked = await enterTown(world, request, "Kit");
  assert.equal("error" in blocked, true);
  if ("error" in blocked) assert.match(blocked.error, /10/);
  assert.equal(world.visitors.length, 10);
  assert.equal(world.log.filter((event) => event.text.includes("walked into the square")).length, 10);
});

test("a suggestion is remembered by the person it names", async () => {
  const world = createWorld();
  const entered = await enterTown(world, requestFrom("203.0.113.10"), "Lark");
  if ("error" in entered) throw new Error(entered.error);
  const said = await visitorSay(world, entered.id, "@Jevaary try the orchard", true);
  assert.equal(said.error, undefined);
  const jevaary = world.people.find((person) => person.name === "Jevaary");
  assert.ok(jevaary?.memory.some((line) => line.text.includes("suggests") && line.text.includes("orchard")));
  assert.ok(world.visitorLog.some((line) => line.includes("Lark")));
});

test("a visitor walks toward the place they chose", () => {
  const world = createWorld();
  world.visitors.push({
    id: "v",
    name: "Ada",
    ipHash: "x",
    place: "square",
    x: 52,
    y: 56,
    facing: "front",
    dest: "grove",
    speech: { text: "on my way", ticks: 1 },
    note: "wanders toward grove",
  });
  stepVisitors(world);
  const visitor = world.visitors[0];
  assert.ok(visitor);
  assert.ok(visitor.x < 52);
  assert.equal(visitor.speech, null);
});
