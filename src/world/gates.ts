/**
 * Feature gates. These are the town's master switches.
 *
 * The town is paused (2026-09-26). With MINDS_LIVE false, no model call can
 * fire — not Jev, not Luna, not the story, not laya — whatever keys exist.
 * The world keeps ticking on code alone: reflexes, law, physics, trade,
 * wildlife. Everything on screen is programmed behavior.
 *
 * Flip both to true to bring the minds back.
 */
export const MINDS_LIVE = false;

/** Visitors stay out while the town is paused: no dock, /api/visit/enter refuses. */
export const VISITORS_OPEN = false;
