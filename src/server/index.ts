import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { decideWithJev } from "./jev.js";
import { compactWithGemini, loadInner, writeChronicle } from "./chronicle.js";
import { loadEnv } from "./env.js";
import { configureFirestore, firestoreReady, loadTown, saveTown } from "./store.js";
import { VISITORS_OPEN } from "../world/gates.js";
import { enterTown, leaveTown, stepVisitors, visitorGo, visitorSay } from "./visitors.js";
import { applyDecision, createWorld, snapshot, tick } from "../world/sim.js";
import { reflexDecide } from "../world/reflex.js";

loadEnv();
configureFirestore();

const world = createWorld();
loadInner(world);
world.soul.configured = Boolean(process.env.TYPESAFE_API_KEY);
world.gemini.configured = Boolean(process.env.OPENAI_API_KEY);
world.gemini.model = process.env.STORY_MODEL || "gpt-6-luna";
world.gemini.status = world.gemini.configured ? "ready" : "off";
world.soul.mode = world.soul.configured ? "jev" : "reflex";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const clients = new Set<ServerResponse>();
const thinking = new Set<string>();
const queue: string[] = [];
let pumping = false;
let nextSoulAt = 0;
const SOUL_GAP_MS = 8000;
let paused = false;
let compacting = false;
let lastCompact = 0;
const storyCalls: number[] = [];
const STORY_GAP_MS = 45_000;
const STORY_HOURLY_CAP = 100;

const server = createServer(async (request, response) => {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = request.url ?? "/";
  if (request.method === "GET" && url === "/api/health") {
    send(response, 200, {
      ok: true,
      jev: world.soul.configured,
      gemini: world.gemini.configured,
      model: world.soul.lastModel,
      geminiModel: world.gemini.model,
      store: firestoreReady(),
    });
    return;
  }
  if (request.method === "GET" && url === "/api/state") {
    send(response, 200, snapshot(world, thinking));
    return;
  }
  if (request.method === "GET" && url === "/api/stream") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(`data: ${JSON.stringify(snapshot(world, thinking))}\n\n`);
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }
  if (request.method === "POST" && url === "/api/pause") {
    const body = await readJson<{ paused?: boolean }>(request);
    paused = Boolean(body.paused);
    send(response, 200, { paused });
    return;
  }
  if (request.method === "POST" && url === "/api/soul") {
    const body = await readJson<{ mode?: string }>(request);
    if (body.mode === "reflex") world.soul.mode = "reflex";
    if (body.mode === "jev") world.soul.mode = world.soul.configured ? "jev" : "reflex";
    send(response, 200, { mode: world.soul.mode, configured: world.soul.configured });
    return;
  }
  if (request.method === "POST" && url === "/api/visit/enter") {
    if (!VISITORS_OPEN) {
      send(response, 403, { error: "The town is not taking visitors right now." });
      return;
    }
    const body = await readJson<{ name?: string }>(request);
    const result = await enterTown(world, request, body.name ?? "");
    send(response, "error" in result ? 400 : 200, result);
    broadcast();
    return;
  }
  if (request.method === "POST" && url === "/api/visit/leave") {
    const body = await readJson<{ id?: string }>(request);
    if (body.id) await leaveTown(world, body.id);
    send(response, 200, { ok: true });
    broadcast();
    return;
  }
  if (request.method === "POST" && url === "/api/visit/go") {
    const body = await readJson<{ id?: string; place?: string }>(request);
    const result = await visitorGo(world, body.id ?? "", body.place ?? "");
    send(response, result.error ? 400 : 200, result);
    broadcast();
    return;
  }
  if (request.method === "POST" && url === "/api/visit/say") {
    const body = await readJson<{ id?: string; text?: string; suggest?: boolean }>(request);
    const result = await visitorSay(world, body.id ?? "", body.text ?? "", Boolean(body.suggest));
    send(response, result.error ? 400 : 200, result);
    broadcast();
    return;
  }
  if (request.method === "POST" && url === "/api/compact") {
    await runCompact();
    send(response, 200, { status: world.gemini.status, error: world.gemini.lastError });
    broadcast();
    return;
  }
  send(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`JEV City listening at http://${HOST}:${PORT}`);
  void loadTown(world).then(() => {
    writeChronicle(world);
    broadcast();
  });
});

setInterval(() => {
  if (paused) {
    broadcast();
    return;
  }
  const mode = world.soul.mode === "jev" && world.soul.configured ? "open" : "reflex";
  const ids = tick(world, mode);
  for (const id of ids) {
    if (thinking.has(id)) continue;
    thinking.add(id);
    queue.push(id);
  }
  stepVisitors(world);
  void pump();
  if (world.tick % 30 === 0) void saveTown(world);
  if (world.tick % 15 === 0) writeChronicle(world);
  if (world.needsSummary && storyBlock() === null) {
    world.needsSummary = false;
    void runCompact();
  }
  broadcast();
}, 1000);

async function pump(): Promise<void> {
  if (pumping || queue.length === 0) return;
  if (world.soul.mode === "jev" && Date.now() < nextSoulAt) return;
  pumping = true;
  world.soul.inFlight = true;
  const batch = queue.splice(0, 4);
  try {
    if (world.soul.mode === "jev" && world.soul.configured) {
      await decideWithJev(world, batch);
    } else {
      for (const id of batch) applyDecision(world, reflexDecide(world, id));
    }
  } catch (error) {
    world.soul.lastError = error instanceof Error ? error.message : "JEV failed";
    for (const id of batch) applyDecision(world, reflexDecide(world, id));
  } finally {
    for (const id of batch) thinking.delete(id);
    pumping = false;
    if (world.soul.mode === "jev") nextSoulAt = Date.now() + SOUL_GAP_MS;
    world.soul.inFlight = queue.length > 0;
    broadcast();
    if (queue.length > 0) void pump();
  }
}

function storyBlock(): string | null {
  const cutoff = Date.now() - 3_600_000;
  while (storyCalls.length > 0 && (storyCalls[0] ?? 0) < cutoff) storyCalls.shift();
  if (storyCalls.length >= STORY_HOURLY_CAP) return "The town story is capped at 100 updates an hour.";
  if (storyCalls.length > 0 && Date.now() - lastCompact < STORY_GAP_MS) return "The next story update is about a minute away.";
  return null;
}

async function runCompact(): Promise<void> {
  const blocked = storyBlock();
  if (blocked) {
    world.gemini.lastError = blocked;
    return;
  }
  if (compacting) return;
  compacting = true;
  lastCompact = Date.now();
  try {
    await compactWithGemini(world);
    if (world.gemini.status === "ready") storyCalls.push(Date.now());
  } finally {
    compacting = false;
    broadcast();
  }
}

function broadcast(): void {
  const payload = `data: ${JSON.stringify(snapshot(world, thinking))}\n\n`;
  for (const client of clients) client.write(payload);
}

function setCors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 100_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
