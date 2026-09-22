import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv } from "../src/server/env.js";
import { runTownBatch } from "../src/server/batch.js";
import {
  claimTownLease,
  configureFirestore,
  firestoreReady,
  loadTown,
  releaseTownLease,
} from "../src/server/store.js";
import { createWorld, snapshot } from "../src/world/sim.js";

export const maxDuration = 240;

loadEnv();
configureFirestore();

function configureWorld() {
  const world = createWorld();
  world.soul.configured = Boolean(process.env.TYPESAFE_API_KEY);
  world.soul.mode = world.soul.configured ? "jev" : "reflex";
  world.gemini.configured = Boolean(process.env.OPENAI_API_KEY);
  world.gemini.model = process.env.STORY_MODEL || "gpt-6-luna";
  world.gemini.status = world.gemini.configured ? "ready" : "off";
  return world;
}

function writeEvent(response: ServerResponse, body: unknown): void {
  if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(body)}\n\n`);
}

function beginStream(request: IncomingMessage, response: ServerResponse, run: (signal: AbortSignal) => Promise<void>): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
  });
  const abort = new AbortController();
  request.on("close", () => abort.abort());
  void run(abort.signal)
    .catch(() => undefined)
    .finally(() => {
      if (!response.writableEnded) response.end();
    });
}

async function readOnly(request: IncomingMessage, response: ServerResponse, world: ReturnType<typeof createWorld>): Promise<void> {
  beginStream(request, response, async (signal) => {
    for (let second = 0; second < 240 && !signal.aborted; second += 1) {
      await loadTown(world);
      writeEvent(response, snapshot(world));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  });
}

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== "GET") {
    response.writeHead(405, { "Content-Type": "text/plain" });
    response.end("Method not allowed");
    return;
  }
  if (!firestoreReady()) {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("Firestore is not configured");
    return;
  }

  const world = configureWorld();
  await loadTown(world);
  const owner = randomUUID();
  if (!await claimTownLease(owner, 300_000)) {
    await readOnly(request, response, world);
    return;
  }

  beginStream(request, response, async (signal) => {
    try {
      writeEvent(response, snapshot(world));
      await runTownBatch(world, (state) => writeEvent(response, state), signal);
    } finally {
      await releaseTownLease(owner);
    }
  });
}
