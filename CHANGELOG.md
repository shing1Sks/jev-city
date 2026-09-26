# Changelog

## 0.2.0 — 2026-09-26 · The V2 town, then the pause

The V2 rebuild, built stage by stage (the log is in `PLAN.md`), and then put on
pause the same day it shipped.

### The town (V2)

- **Body**: continuous grid map with real A* walking; resource nodes with depletion,
  regrowth, and RNG scatter; carried inventory and physical household stores; earned
  construction (mark → haul → raise stage by stage); weather Markov chain with storm
  windfalls; 1 tick = 1 in-world minute.
- **Spine (Jev, TypeSafe System One)**: recursive step execution — one batched call of
  six agents every six seconds answers typed questions over legal steps. Jev never
  writes a sentence.
- **Brain (Luna, GPT-6 at temperature 1.0)**: one call every three real minutes sets
  tasks, thoughts, dialogue lines with typed acts (request/give/invite/warn/comfort/
  thank/tease), names newborns, and consolidates memory. Identity block anchors drift.
- **Base agent**: identity seed, Luna-consolidated long-term self, weighted episodic
  ring (salience, fade), dawn consolidation into standing beliefs; favors gone stale
  become slights; relevance-ranked recall feeds both model prompts.
- **Town life**: wildlife (3 crows, 2 deer, 1 dog) on code instincts — crows strip
  ripe berry bushes and the theft is witnessed; illness with home confinement and
  comfort-cure; barter at the market and stalls when household stores complement;
  festivals on finished builds, vigils on deaths, a naming rite for newborns.
- **Web**: filterable town-history panel (kind, person, today); resident dossiers with
  beliefs and private lines; visitor dock (gated); story card; day/night and weather
  on the stage.
- **Infra**: Firestore persistence, Vercel batch runner with a town lease and
  read-only streams, 88 tests.

### The pause

- New `MINDS_LIVE` gate in `src/world/gates.ts`, default **false**: every mind config
  (Jev, Luna, laya, story) resolves to `null` before any call site runs — the build
  makes zero model calls even with keys present, locally and on Vercel.
- Paused banner on the page explaining that everything on screen is programmed
  behavior; GitHub link in the header.
- `VISITORS_OPEN` back to **false**: no visitor dock, `/api/visit/enter` refuses.
  The visitor subsystem stays in the codebase for when the door opens again.

## 0.1.0 — 2026-09 (V1)

First town: ten-place graph map, JEV as a per-act menu picker, GPT end-of-day
summaries, closed-lexicon speech, Firestore persistence, Vercel batch runner.
