import type { CityEvent, World } from "./types.js";

/**
 * Salience: which logged moments deserve a brain's attention and a story's
 * lines. Pure scoring over the town log — kind weight × recency, with a bump
 * for town-wide moments. Feeds the brain roster, the brain prompt digest, and
 * the chronicle, so narration is drawn from what mattered, not the last
 * dozen lines in order.
 */

const KIND_WEIGHT: Record<CityEvent["kind"], number> = {
  life: 40,
  build: 26,
  weather: 18,
  law: 12,
  work: 8,
  speech: 4,
  meal: 5,
  move: 1,
};

/** Events fade from salience over roughly four in-world hours. */
const FADE_TICKS = 240;

export function salienceScore(world: World, event: CityEvent): number {
  const age = Math.max(0, world.tick - event.tick);
  const recency = Math.max(0, 1 - age / FADE_TICKS);
  let score = KIND_WEIGHT[event.kind] * recency;
  if (event.kind === "speech") {
    if (event.audience === "town") score += 6;
    if (event.audience === "private") score += 2;
  }
  return score;
}

/** The most salient events since a tick, best first. */
export function salientEvents(world: World, sinceTick: number, limit: number): CityEvent[] {
  return world.log
    .filter((event) => event.tick >= sinceTick)
    .map((event) => ({ event, score: salienceScore(world, event) }))
    .sort((left, right) => right.score - left.score || right.event.tick - left.event.tick)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.event);
}

/**
 * People worth a brain tick because something notable touched them: speakers,
 * named listeners, and witnesses of high-salience moments, in event order.
 */
export function rosterFromEvents(world: World, sinceTick: number): string[] {
  const roster: string[] = [];
  for (const event of world.log.filter((item) => item.tick >= sinceTick)) {
    if (salienceScore(world, event) < 6) continue;
    for (const id of [event.speakerId, event.listenerId, ...event.heardBy]) {
      if (id && !roster.includes(id)) roster.push(id);
    }
  }
  return roster;
}
