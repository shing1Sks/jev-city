import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { beastConfigFromEnv, beastTick } from "./beasts.js";
import { brainConfigFromEnv, brainTick } from "./brain.js";
import { decideWithJev, jevConfigFromEnv } from "./jev.js";
import { compactStory, loadInner, writeChronicle } from "./chronicle.js";
import { loadEnv } from "./env.js";
import { configureFirestore, firestoreReady, loadTown, saveTown } from "./store.js";
import { MINDS_LIVE, VISITORS_OPEN } from "../world/gates.js";
import { enterTown, leaveTown, stepVisitors, visitorGo, visitorSay } from "./visitors.js";
import { applyDecision, createWorld, snapshot, tick } from "../world/sim.js";
import { reflexDecide } from "../world/reflex.js";

loadEnv();
configureFirestore();

const world = createWorld();
loadInner(world);
// The pause is upstream of every mind: with MINDS_LIVE false no config object
// is ever built, so no call site can fire even with keys present.
const jev = MINDS_LIVE ? jevConfigFromEnv() : null;
const luna = MINDS_LIVE ? brainConfigFromEnv() : null;
const beast = MINDS_LIVE ? beastConfigFromEnv() : null;
world.brain.configured = Boolean(luna);
world.brain.status = world.brain.configured ? "ready" : "off";
world.beast.configured = Boolean(beast);
world.beast.status = world.beast.configured ? "ready" : "off";
world.soul.configured = Boolean(jev);
world.luna.configured = MINDS_LIVE ? Boolean(process.env.OPENAI_API_KEY) : false;
world.luna.model = process.env.STORY_MODEL || "gpt-6-luna";
world.luna.status = world.luna.configured ? "ready" : "off";
// The spine (Stage 2) answers the step question whenever a key is present;
// without one the brainstem reflex runs the town, unchanged.
world.soul.mode = jev ? "jev" : "reflex";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = "127.0.0.1";
const clients = new Set<ServerResponse>();
const thinking = new Set<string>();
const queue: string[] = [];
let pumping = false;
let nextSoulAt = 0;
// Spine cadence: one batched call of 6 agents, one batch every 6 s (PLAN F6).
const SOUL_GAP_MS = 6000;
const SOUL_BATCH = 6;
// Brain cadence: one Luna call every 3 real minutes, budgeted in brain.ts.
const BRAIN_GAP_MS = 180_000;
let nextBrainAt = 0;
let brainRunning = false;
// Beast cadence: one laya urge-batch every 15 s when LAYA_URL is set.
const BEAST_GAP_MS = 15_000;
let nextBeastAt = 0;
let beastRunning = false;
let paused = false;
let speed = 1;
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
      mode: world.soul.mode,
      story: world.luna.configured,
      model: world.soul.lastModel,
      storyModel: world.luna.model,
      spineCalls: world.soul.calls,
      spineTokens: { input: world.soul.inputTokens, output: world.soul.outputTokens },
      spineCostUsd: Number((world.soul.costUsd ?? 0).toFixed(4)),
      spineTokensThisHour: world.soul.tokensThisHour ?? 0,
      spineTokenCap: jev?.tokenCap ?? 0,
      spineError: world.soul.lastError,
      brain: world.brain.configured,
      brainStatus: world.brain.status,
      brainCalls: world.brain.calls,
      brainTokens: { input: world.brain.inputTokens, output: world.brain.outputTokens },
      brainCostUsd: Number((world.brain.costUsd ?? 0).toFixed(4)),
      brainError: world.brain.lastError,
      beast: world.beast.configured,
      beastStatus: world.beast.status,
      beastCalls: world.beast.calls,
      beastError: world.beast.lastError,
      store: firestoreReady(),
      speed,
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
  if (request.method === "POST" && url === "/api/speed") {
    const body = await readJson<{ speed?: number }>(request);
    speed = [1, 2, 4].includes(Number(body.speed)) ? Number(body.speed) : 1;
    send(response, 200, { speed });
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
    send(response, 200, { status: world.luna.status, error: world.luna.lastError });
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
  for (let step = 0; step < speed; step += 1) {
    const ids = tick(world, mode);
    for (const id of ids) {
      if (thinking.has(id)) continue;
      thinking.add(id);
      queue.push(id);
    }
  }
  stepVisitors(world);
  void pump();
  if (luna && !brainRunning && Date.now() >= nextBrainAt) {
    brainRunning = true;
    nextBrainAt = Date.now() + BRAIN_GAP_MS;
    void brainTick(world, luna).finally(() => {
      brainRunning = false;
      broadcast();
    });
  }
  if (beast && !beastRunning && Date.now() >= nextBeastAt) {
    beastRunning = true;
    nextBeastAt = Date.now() + BEAST_GAP_MS;
    void beastTick(world, beast).finally(() => {
      beastRunning = false;
      broadcast();
    });
  }
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
  const batch = queue.splice(0, SOUL_BATCH);
  try {
    if (world.soul.mode === "jev" && world.soul.configured) {
      await decideWithJev(world, batch, jev);
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
  if (!MINDS_LIVE) {
    world.luna.status = "off";
    return;
  }
  const blocked = storyBlock();
  if (blocked) {
    world.luna.lastError = blocked;
    return;
  }
  if (compacting) return;
  compacting = true;
  lastCompact = Date.now();
  try {
    await compactStory(world);
    if (world.luna.status === "ready") storyCalls.push(Date.now());
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
