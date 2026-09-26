import { compactStory } from "./chronicle.js";
import { decideWithJev } from "./jev.js";
import { saveTown } from "./store.js";
import { stepVisitors } from "./visitors.js";
import { applyDecision, snapshot, tick } from "../world/sim.js";
import { reflexDecide } from "../world/reflex.js";
import { MINDS_LIVE } from "../world/gates.js";
import type { PublicState, World } from "../world/types.js";

export const TICKS_PER_BATCH = 120;
// Spine cadence: 6 agents per batched call, one batch every 6 s (PLAN F6).
const SOUL_GAP_MS = 6_000;
const SOUL_BATCH = 6;

type Emit = (state: PublicState) => void;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function runTownBatch(world: World, emit: Emit, signal: AbortSignal): Promise<void> {
  const thinking = new Set<string>();
  const queue: string[] = [];
  let pumping = false;
  let nextSoulAt = 0;
  let compacting = false;

  async function pump(): Promise<void> {
    if (pumping || queue.length === 0) return;
    if (world.soul.mode === "jev" && Date.now() < nextSoulAt) return;
    pumping = true;
    world.soul.inFlight = true;
    const batch = queue.splice(0, SOUL_BATCH);
    try {
      if (MINDS_LIVE && world.soul.mode === "jev" && world.soul.configured) {
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
      emit(snapshot(world, thinking));
      if (queue.length > 0 && !signal.aborted) void pump();
    }
  }

  for (let step = 0; step < TICKS_PER_BATCH && !signal.aborted; step += 1) {
    const mode = world.soul.mode === "jev" && world.soul.configured ? "open" : "reflex";
    const ids = tick(world, mode);
    for (const id of ids) {
      if (thinking.has(id)) continue;
      thinking.add(id);
      queue.push(id);
    }
    stepVisitors(world);
    void pump();

    if (world.tick % 30 === 0) await saveTown(world);
    if (MINDS_LIVE && world.needsSummary && !compacting) {
      world.needsSummary = false;
      compacting = true;
      try {
        await compactStory(world);
      } finally {
        compacting = false;
      }
    }

    emit(snapshot(world, thinking));
    await wait(1_000, signal);
  }

  await saveTown(world);
}
