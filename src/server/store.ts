import { createHash } from "node:crypto";
import type { World } from "../world/types.js";

export function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

let projectId = "";
let apiKey = "";
let warned = false;

export function firestoreReady(): boolean {
  return Boolean(projectId && apiKey);
}

export function configureFirestore(): void {
  projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  apiKey = process.env.FIREBASE_API_KEY ?? "";
}

function root(): string {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function encode(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === "object") {
    const fields: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) fields[key] = encode(item);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function decode(value: Record<string, unknown> | undefined): unknown {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: Record<string, unknown>[] } | undefined)?.values ?? [];
    return values.map((item) => decode(item));
  }
  if ("mapValue" in value) {
    const fields = (value.mapValue as { fields?: Record<string, Record<string, unknown>> } | undefined)?.fields ?? {};
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(fields)) out[key] = decode(item);
    return out;
  }
  return null;
}

async function writeDoc(path: string, data: unknown): Promise<void> {
  if (!firestoreReady()) return;
  const url = `${root()}/${path}?key=${apiKey}`;
  const body = JSON.stringify({ fields: (encode(data) as { mapValue: { fields: unknown } }).mapValue.fields });
  const patch = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
  if (patch.ok) return;
  if (patch.status !== 404) {
    const detail = (await patch.text()).slice(0, 160);
    throw new Error(`Firestore ${patch.status}: ${detail}`);
  }
  const parts = path.split("/");
  const id = parts.pop();
  const parent = parts.join("/");
  const created = await fetch(`${root()}/${parent}?documentId=${id}&key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!created.ok) {
    const detail = (await created.text()).slice(0, 160);
    throw new Error(`Firestore ${created.status}: ${detail}`);
  }
}

async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  if (!firestoreReady()) return null;
  const response = await fetch(`${root()}/${path}?key=${apiKey}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 160);
    throw new Error(`Firestore ${response.status}: ${detail}`);
  }
  const body = (await response.json()) as { fields?: Record<string, Record<string, unknown>> };
  return (decode({ mapValue: { fields: body.fields ?? {} } }) as Record<string, unknown>) ?? null;
}

export async function ipCount(hash: string): Promise<number> {
  try {
    const doc = await readDoc(`ipSeats/${hash}`);
    return typeof doc?.count === "number" ? doc.count : 0;
  } catch (error) {
    note(error);
    return 0;
  }
}

export async function setIpCount(hash: string, count: number): Promise<void> {
  try {
    await writeDoc(`ipSeats/${hash}`, { count, at: new Date().toISOString() });
  } catch (error) {
    note(error);
  }
}

export async function saveVisitor(visitor: { id: string; name: string; ipHash: string; note: string; active: boolean }): Promise<void> {
  try {
    await writeDoc(`visitors/${visitor.id}`, { ...visitor, at: new Date().toISOString() });
  } catch (error) {
    note(error);
  }
}

export async function addVisitorLog(id: string, line: string): Promise<void> {
  try {
    await writeDoc(`visitorLog/${id}-${Date.now()}`, { visitorId: id, line, at: new Date().toISOString() });
  } catch (error) {
    note(error);
  }
}

export async function saveTown(world: World): Promise<void> {
  try {
    await writeDoc("town/state", {
      schema: world.schema,
      tick: world.tick,
      hour: world.hour,
      minute: world.minute,
      phase: world.phase,
      weather: world.weather,
      day: world.day,
      solMinutes: world.solMinutes,
      needsSummary: world.needsSummary,
      summaryFor: world.summaryFor,
      rng: world.rng,
      story: world.story,
      chronicle: world.chronicle,
      chronicleAt: world.chronicleAt,
      storages: world.storages,
      nodes: world.nodes,
      sites: world.sites,
      animals: world.animals,
      expansions: world.expansions,
      bonds: world.bonds,
      log: world.log,
      nextEventId: world.nextEventId,
      uncompiled: world.uncompiled,
      people: world.people,
      visitors: world.visitors,
      visitorLog: world.visitorLog.slice(-40),
    });
  } catch (error) {
    note(error);
  }
}

export async function loadTown(world: World): Promise<void> {
  try {
    const saved = await readDoc("town/state");
    if (!saved) return;
    // A V1 save (place-state world, no schema field) describes a different
    // town; Stage 2's continuous world starts fresh rather than half-loading.
    if (saved.schema !== 2) return;
    if (typeof saved.tick === "number") world.tick = saved.tick;
    if (typeof saved.hour === "number") world.hour = saved.hour;
    if (typeof saved.minute === "number") world.minute = saved.minute;
    if (typeof saved.phase === "string") world.phase = saved.phase as World["phase"];
    if (typeof saved.weather === "string") world.weather = saved.weather as World["weather"];
    if (typeof saved.day === "number") world.day = saved.day;
    if (typeof saved.solMinutes === "number") {
      world.solMinutes = saved.solMinutes;
      world.hour = Math.floor(saved.solMinutes / 60) % 24;
      world.minute = saved.solMinutes % 60;
    }
    if (typeof saved.rng === "number") world.rng = saved.rng;
    if (saved.story && typeof saved.story === "object") world.story = saved.story as World["story"];
    if (typeof saved.chronicle === "string") world.chronicle = saved.chronicle;
    if (typeof saved.chronicleAt === "string" || saved.chronicleAt === null) world.chronicleAt = saved.chronicleAt as string | null;
    if (typeof saved.needsSummary === "boolean") world.needsSummary = saved.needsSummary;
    if (typeof saved.summaryFor === "number" || saved.summaryFor === null) world.summaryFor = saved.summaryFor as number | null;
    if (saved.storages && typeof saved.storages === "object") world.storages = saved.storages as World["storages"];
    if (Array.isArray(saved.nodes)) world.nodes = saved.nodes as World["nodes"];
    if (Array.isArray(saved.sites)) world.sites = saved.sites as World["sites"];
    if (Array.isArray(saved.animals)) world.animals = saved.animals as World["animals"];
    if (Array.isArray(saved.expansions)) world.expansions = saved.expansions as World["expansions"];
    if (Array.isArray(saved.bonds)) world.bonds = saved.bonds as World["bonds"];
    if (Array.isArray(saved.log)) world.log = saved.log as World["log"];
    if (typeof saved.nextEventId === "number") world.nextEventId = saved.nextEventId;
    if (typeof saved.uncompiled === "number") world.uncompiled = saved.uncompiled;
    if (Array.isArray(saved.visitors)) world.visitors = saved.visitors as World["visitors"];
    if (Array.isArray(saved.visitorLog)) world.visitorLog = saved.visitorLog as string[];
    if (Array.isArray(saved.people)) {
      for (const item of saved.people as World["people"]) {
        const person = world.people.find((candidate) => candidate.id === item.id);
        if (!person) continue;
        Object.assign(person, item);
      }
      // People born in a previous run are not in the seed cast; append them.
      const known = new Set(world.people.map((person) => person.id));
      for (const item of saved.people as World["people"]) {
        if (!known.has(item.id)) world.people.push(item);
      }
    }
  } catch (error) {
    note(error);
  }
}

export async function claimTownLease(owner: string, ttlMs: number): Promise<boolean> {
  try {
    const current = await readDoc("town/runner");
    const until = typeof current?.until === "number" ? current.until : 0;
    if (current?.owner && current.owner !== owner && until > Date.now()) return false;
    await writeDoc("town/runner", { owner, until: Date.now() + ttlMs });
    const claimed = await readDoc("town/runner");
    return claimed?.owner === owner;
  } catch (error) {
    note(error);
    return false;
  }
}

export async function townLeaseOwner(owner: string): Promise<boolean> {
  try {
    const current = await readDoc("town/runner");
    return current?.owner === owner && typeof current.until === "number" && current.until > Date.now();
  } catch (error) {
    note(error);
    return false;
  }
}

export async function releaseTownLease(owner: string): Promise<void> {
  try {
    const current = await readDoc("town/runner");
    if (current?.owner === owner) await writeDoc("town/runner", { owner: "", until: 0 });
  } catch (error) {
    note(error);
  }
}

function note(error: unknown): void {
  if (warned) return;
  warned = true;
  const message = error instanceof Error ? error.message : "Firestore failed";
  console.log(message.replace(/key=[^&\s"]+/g, "key=redacted"));
}
