import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { placeOf } from "../world/map.js";
import { parseVisitorTalk } from "../world/talk.js";
import type { PlaceId, TownVisitor, World } from "../world/types.js";
import { addVisitorLog, hashIp, ipCount, saveTown, saveVisitor, setIpCount } from "./store.js";

const LIMIT = 10;

function rememberLine(world: World, line: string): void {
  world.visitorLog.push(line);
  if (world.visitorLog.length > 40) world.visitorLog.shift();
}

export function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0]?.trim() || "local";
  return request.socket.remoteAddress ?? "local";
}

export async function enterTown(world: World, request: IncomingMessage, rawName: string): Promise<{ id: string; name: string } | { error: string }> {
  const name = rawName.trim().replace(/\s+/g, " ").slice(0, 18);
  if (!/^[A-Za-z][A-Za-z '-]{1,17}$/.test(name)) return { error: "Use a short name, letters only." };
  const taken = world.people.some((person) => person.name.toLowerCase() === name.toLowerCase())
    || world.visitors.some((visitor) => visitor.name.toLowerCase() === name.toLowerCase());
  if (taken) return { error: "That name is already in the town." };
  const ipHash = hashIp(clientIp(request));
  const stored = await ipCount(ipHash);
  const local = world.visitors.filter((visitor) => visitor.ipHash === ipHash).length;
  if (Math.max(stored, local) >= LIMIT) return { error: "This address already has 10 visitors in the town." };
  const spot = placeOf("square");
  const visitor: TownVisitor = {
    id: randomUUID(),
    name,
    ipHash,
    place: "square",
    x: spot.x + (local - 1),
    y: spot.y + 2,
    facing: "front",
    dest: null,
    speech: null,
    note: "just arrived, still looking",
  };
  world.visitors.push(visitor);
  const line = `Visitor ${name} walked into the square.`;
  rememberLine(world, line);
  world.uncompiled += 1;
  world.log.push({
    id: world.nextEventId++,
    tick: world.tick,
    clock: `${String(world.hour).padStart(2, "0")}:${String(world.minute).padStart(2, "0")}`,
    kind: "speech",
    speakerId: null,
    audience: "town",
    listenerId: null,
    place: "square",
    text: line,
    heardBy: world.people.filter((person) => person.alive).map((person) => person.id),
  });
  await setIpCount(ipHash, Math.max(stored, local) + 1);
  await saveVisitor({ id: visitor.id, name, ipHash, note: visitor.note, active: true });
  await addVisitorLog(visitor.id, line);
  await saveTown(world);
  return { id: visitor.id, name };
}

export async function leaveTown(world: World, id: string): Promise<void> {
  const index = world.visitors.findIndex((visitor) => visitor.id === id);
  if (index < 0) return;
  const visitor = world.visitors[index];
  if (!visitor) return;
  world.visitors.splice(index, 1);
  const line = `Visitor ${visitor.name} left the town.`;
  rememberLine(world, line);
  const count = await ipCount(visitor.ipHash);
  await setIpCount(visitor.ipHash, Math.max(0, count - 1));
  await saveVisitor({ id: visitor.id, name: visitor.name, ipHash: visitor.ipHash, note: visitor.note, active: false });
  await addVisitorLog(visitor.id, line);
  await saveTown(world);
}

export async function visitorGo(world: World, id: string, place: string): Promise<{ error?: string }> {
  const visitor = world.visitors.find((item) => item.id === id);
  if (!visitor) return { error: "You are no longer in the town." };
  const known = ["grove", "mill", "field", "well", "vale", "square", "hearth", "market", "rise", "porch"];
  if (!known.includes(place)) return { error: "That place is not in the town." };
  visitor.dest = place as PlaceId;
  const line = `Visitor ${visitor.name} set off for ${place}.`;
  visitor.note = `wanders toward ${place}`;
  rememberLine(world, line);
  await addVisitorLog(visitor.id, line);
  return {};
}

export async function visitorSay(world: World, id: string, text: string, suggest: boolean): Promise<{ error?: string }> {
  const visitor = world.visitors.find((item) => item.id === id);
  if (!visitor) return { error: "You are no longer in the town." };
  const names = world.people.filter((person) => person.alive).map((person) => ({ id: person.id, name: person.name }));
  const parsed = parseVisitorTalk(suggest ? `suggest ${text}` : text, names);
  if (parsed.error) return { error: parsed.error };
  const label = `Visitor ${visitor.name}`;
  const targets = world.people.filter((person) => parsed.ids.includes(person.id));
  const targetNames = targets.map((person) => person.name).join(", ");
  const line = parsed.suggest
    ? parsed.audience === "town"
      ? `${label} suggests to the town: ${parsed.body}`
      : `${label} suggests to ${targetNames}: ${parsed.body}`
    : parsed.audience === "town"
      ? `${label} to the town: ${parsed.body}`
      : `${label} to ${targetNames}: ${parsed.body}`;
  visitor.speech = { text: parsed.suggest ? `suggests: ${parsed.body}` : parsed.body, ticks: 8 };
  visitor.note = parsed.suggest ? `suggested ${parsed.body}` : `spoke to ${parsed.audience === "town" ? "everyone" : targetNames}`;
  rememberLine(world, line);
  const heard = parsed.audience === "town" ? world.people.filter((person) => person.alive) : targets;
  for (const person of heard) {
    person.memory.push({ clock: `${String(world.hour).padStart(2, "0")}:${String(world.minute).padStart(2, "0")}`, text: line, private: parsed.audience === "direct" });
    if (person.memory.length > 12) person.memory.shift();
    person.belonging = Math.min(100, person.belonging + 1);
  }
  world.log.push({
    id: world.nextEventId++,
    tick: world.tick,
    clock: `${String(world.hour).padStart(2, "0")}:${String(world.minute).padStart(2, "0")}`,
    kind: "speech",
    speakerId: null,
    audience: parsed.audience === "town" ? "town" : "private",
    listenerId: targets[0]?.id ?? null,
    place: visitor.place,
    text: line,
    heardBy: heard.map((person) => person.id),
  });
  world.uncompiled += 1;
  await addVisitorLog(visitor.id, line);
  await saveVisitor({ id: visitor.id, name: visitor.name, ipHash: visitor.ipHash, note: visitor.note, active: true });
  return {};
}

export function stepVisitors(world: World): void {
  for (const visitor of world.visitors) {
    if (visitor.speech) {
      visitor.speech.ticks -= 1;
      if (visitor.speech.ticks <= 0) visitor.speech = null;
    }
    if (!visitor.dest) continue;
    const target = placeOf(visitor.dest);
    const dx = target.x - visitor.x;
    const dy = target.y - visitor.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1.4) {
      visitor.x = target.x;
      visitor.y = target.y;
      visitor.place = visitor.dest;
      visitor.dest = null;
      continue;
    }
    visitor.x += (dx / distance) * 0.5;
    visitor.y += (dy / distance) * 0.5;
    visitor.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "front" : "back";
  }
}
