# JevCity V2 — Brain / Spine / Body

Status: Stages 1–4 **built and gated** (2026-09-26). Stage 5 in pitch. Every point from the 2026-09-24 discussion and every finding from the code read is logged in §8 and mapped to a stage.

---

## 1. Why we are rebuilding

V1 works as a toy but the intelligence is capped by design:

- **Jev is used as a menu-picker.** Each turn it answers ~7 independent multiple-choice questions ("which act? speak? which word?"). No plans, no memory consumption, no dialogue. Its long-horizon judgment — the thing TypeSafe System One is supposedly good at — is never exercised.
- **Luna is used as a decorator.** One end-of-day summary, mostly narrating routine because the sim cannot generate events. Words have zero causal weight: "NEED food" changes nothing.
- **The world is a state machine, not a place.** Ten graph nodes you teleport between (via walked paths), larders that fill by magic, deterministic weather, no objects you can pick up, mine, chop, or build with. Residents are given houses and roads and can never earn anything new.
- **Two engine bugs contradict the design:** telepathic jealousy (`sim.ts` spouse reacts to private speech they never heard) and `bendTowardMatter` steamrolling Jev's explicit audience choices.

V2 inverts the hierarchy. The expensive-ish, judgment-strong model stops picking steps; the cheap, high-temperature model stops being a post-hoc narrator.

## 2. The architecture

Three layers, named by role in a nervous system:

```
LUNA  (the brain)        intention · dialogue · memory · naming — RARE, batched, hot
  │   issues Tasks + Thoughts + Dialogue lines + typed speech-acts
  ▼
JEV   (the spine)        recursive step execution — FREQUENT, batched, typed choices
  │   "given my Task and the world right now, what is my next legal Step?"
  ▼
CODE  (the body + brainstem)  physics · needs · law · reflexes — NO LLM, ever
```

### 2.1 Luna — the brain

- **What it decides** (per agent, in one batched JSON response):
  - `intention`: a Task (goal + target hint + stance), or "continue"
  - `thought`: one private line shown in the UI (the agent's inner voice — this is the "implicit behavior" layer)
  - `dialogue`: optional lines to deliver when the agent is next co-located with someone (with a typed `act` payload — see §3)
  - `memoryPatch`: incremental rewrite of the agent's long-term self-summary and stances
  - `naming`: names for newborns (replaces the `Jev+syllable` generator)
  - town-level `chronicle` delta when a day closes or a notable event fires
- **When it is called** — a **brain tick**, every ~3 real minutes, covering ALL agents that (a) finished a task, (b) are stuck/failed, or (c) are involved in a notable event. One HTTP call per tick. Additional triggers: day close, death, birth, storm, stranger.
- **Temperature**: 0.9–1.0 (near max, per Shreyash), anchored against drift by an immutable identity block in the prompt (§4). High temp is where the "more things" variety comes from.
- **Budget guard (hard)**: ≤ 60 calls/hour, ≤ 8k input tokens/call typical, hard failover to the code-side intention table when exceeded. Telemetry mirrored on `world.brain` like the existing `world.soul` token counters.
- **Never does**: pick steps, choose movement, answer "how". It says what and why and in which words.

### 2.2 Jev — the spine

- **What it does**: holds a Task and answers one typed question per call: *"Given my identity, my long-term memory, my task, and what I can perceive here — which of these legal Steps is next?"* — a `choice` over code-generated legal steps, same SDK pattern as V1 (`@typesafe-ai/sdk` `choice`/`noul`). A `noul` question answers "is this task still worth pursuing?" for abandon/escalate.
- **Recursive by design**: no monolithic plans. The world changes (nodes deplete, people move, rain starts); re-deciding each step is the robust shape. Steps are long in wall-time (a cross-town walk is 20+ ticks), so decision frequency per agent drops sharply vs V1.
- **Cadence**: batch of 6 agents per call, one batch every 6 s (~1 decision/sec town-wide capacity). Jev is effectively free for now — no cap needed, per Shreyash. The 8 s/4-agent V1 pattern is the fallback if the SDK rate-limits.
- **Owns micro-expression**: the lexicon stamps (WORD topic tone-emoji) survive as the agent's *body language* — chosen by Jev alongside steps, zero Luna cost. Tired/hungry/afraid stamps fall out of need state (§5.4).
- **Fallback**: low confidence or missing key → the reflex policy (kept, but only as brainstem).

### 2.3 Code — the body and brainstem

- The tick (1 s), movement on a continuous map, needs decay, law (bands/curfew/custody), resource nodes, inventory, construction, weather RNG, animal instincts, witnessing, salience scoring, persistence.
- **Brainstem interrupts** (no LLM, fire instantly, override everything): toddler abandoned → cry + guardian duty; exhaustion floor → forced rest; danger → flee/shelter; curfew → home.
- Law still deletes anything illegal before any model ever sees it. This V1 principle is correct and stays.

## 3. Speech: two channels, and words that do things

| Channel | Author | Cost | Form | Effect |
| --- | --- | --- | --- | --- |
| **Stamp** (expression) | Jev / need-state | free | `NEED food 🍽️` bubble | mood signal only |
| **Language** (dialogue) | Luna | brain tick | real lines as subtitles | **causal** via typed act |

Instrumental speech — the single biggest V1 gap — is solved without extra calls: every Luna dialogue line carries a machine-readable `act`, e.g. `{kind:"request", item:"wood", qty:2}`, `{kind:"offer", give:"grain", want:"cloth"}`, `{kind:"invite", to:"build", site:"…"}`. The receiving agent's spine (Jev) accepts/declines against its current task and law; code executes the transfer or creates the follow-on Task. Luna writes words; Jev decides uptake; code moves the goods. Private/here/town audiences survive; **emotional reactions now require witnessing** (you react to what you heard, not what you didn't — kills the telepathy bug).

## 4. The base agent (personality, memory, recurrence — built in, not bolted on)

Per-agent memory hierarchy, all persisted:

1. **Identity** (seed): temper, want, fear, habit, ambition. Immutable except by rare character-development at major life events (Luna).
2. **Long-term self** (Luna-consolidated, incremental): 3–6 sentence self-narrative + stance map (per person: warmth/grudge/trust) + open threads ("still owes Jevon cloth").
3. **Episodic** (code-written): salience-scored events (weight = event-type × involvement × recency), capped ~40, pruned by score.
4. **Working** (code): last ~12 perceived events.

Recurrence: spine prompts always carry identity + long-term + current task + local view; brain prompts carry identity + long-term + episodic digest. This replaces the global `compactWithGemini`/`data/inner.json` bolt-on — memory lives in the agent, survives restarts, and feeds both models.

**Need effects are engineered, not decorative** (the "complex and very specifically built" requirement):
- hunger ↑ → carry capacity and work speed scale down; stamp frequency of `NEED food` rises
- energy ↓ → walk speed drops, stumble/idle pauses, forced micro-rest below floor
- belonging ↓ → seek-populated-places bias, chatter stamps rise, task persistence drops
Concrete curves specified and unit-tested in Stage 4 (e.g. speed multiplier `0.6 + 0.4·(energy/100)`, breakpoints at 30/60).

## 5. The world (environment, resources, growth)

### 5.1 Continuous map
- Grid ~120×68 cells rendered into the existing SVG stage (visual style unchanged). Walkable mask from terrain + entity footprints; A* with path smoothing; roads faster; water blocks.
- No more node-hopping. `moveTo` is a real multi-tick walk. The 10 named places remain as *regions* (labels, meeting points), not as teleport targets.

### 5.2 Resource nodes (RNG + own behavior)
- **Trees** (wood): cluster spawn (grove density), 3 depletion stages → stump; regrow over in-world days, weather-modulated.
- **Rocks/outcrops** (stone): spawn on the rise/scarps; sizes deplete to rubble; slow respawns elsewhere.
- **Crops** (farm plots + berry bushes): plant → sprout → ripe → harvest; rain boosts growth, storm damages; winter pause (later).
- Initial scatter seeded with a fixed RNG seed + per-day rolls. Distribution is procedural, not hand-placed.

### 5.3 Inventory, carrying, and earned construction
- Personal carry capacity by band; items: wood, stone, grain, flour, berries, cloth.
- Household storage is a physical container at the home building (the magic larder dies).
- **Building is earned**: mark site → deliver materials (visible piles) → staged construction → finished entity with function (stall → trade scenes; shrine → ceremonies; watchtower → alert radius; house → new home). The initial houses/roads stay given — everything after them is work.

### 5.4 Time, weather, seasons
- **Proposal**: 1 tick = 1 in-world minute → day = 24 real minutes (V1: 1 minute). Speed toggle 1×/2×/4×. Slower days make walking/working legible, hide Jev latency, and cut narrative calls 24×. *Needs Shreyash's sign-off — §9.*
- Weather: Markov chain per phase (clear/cloudy/rain/wind/storm), seasons on 30-day months. Storms are events: felled trees (wood windfall), crop damage, shelter rushes.

### 5.5 Animals
- Code-instinct FSM first: graze / wander / flee / follow / sleep. Chickens (eggs→food), sheep (wool→cloth), a dog (follows/barks/alerts).
- "Simple Jev behavior" layer (flag-on): one batched Jev call for all animals every ~30 s deciding a novelty move (approach person, play, new wander target). Never Luna.

## 6. Town log, history, and names

- **Structured event store**: typed events (birth, death, arrival, build, harvest, trade, dialogue-scene, storm, ceremony, naming) with day/clock/actors/place/visibility. Append-only, persisted (Firestore + local JSONL), queryable.
- **Timeline UI**: filterable (by person, category, day), click-through to dossiers, day cards. This is the "town history" view — deaths, births, arrivals, who did what.
- **Names**: Luna names newborns at brain ticks (name + one-line meaning, constrained to the town's phonology), fallback = syllable-Markov generator over the existing name corpus. No more `Jeveth`-by-formula.
- Births/death get ceremonies (naming rite, vigil) → real material for Luna, which is how stories stop being monotonous: narration is drawn from salience-ranked real events, not routine.

## 7. Cost model (GPT-6 Luna, verified 2026-09-24)

OpenAI Standard pricing, short context (all our calls): **$0.10/M input · $0.01/M cached input · $0.50/M output**. Luna is the cheapest GPT-6 model (Sol is 20×, Astra 100×) — no cheaper in-family switch exists. Batch/Flex halves all prices. (Long-context tier $0.20/$0.75 only applies above the short-context cutoff, which we never approach at ~4k tokens/call.)

Architecture-driven load, defaults (brain tick every 3 min, only agents needing direction included):

| Scenario | Calls/hr | In tok/call | Out tok/call | $/hr | Per 8-h watch | Per 30 d, 24/7 |
| --- | --- | --- | --- | --- | --- | --- |
| Typical | 25 | 4k | 1.5k | **$0.029** | $0.23 | $21 |
| Busy (events, dialogues) | 40 | 5k | 2k | $0.060 | $0.48 | $43 |
| Hard-cap ceiling | 60 | 6k | 2k | $0.078 | $0.63 | $56 |

- With a stable prompt prefix (identity scaffolding), cached input at $0.01/M cuts the input line ~90% — typical case drops toward **$0.02/hr**.
- **V2 is cheaper than V1** ($0.068/hr at 60 stories/hr) while doing strictly more, because the 1-minute day dies.
- Jev (SystemOne): $42/Btok input, output free (verified live 2026-09-24). Measured real pace ≈ $0.00026/call, ~1.6 calls/min → **≈ $0.85/day at 24/7**; hourly token valve (2.5M tok, env-tunable) caps the worst case at $2.52/day. Token telemetry tracked in `world.soul` and surfaced in the UI health chip, so real spend is verifiable while it runs.
- OpenRouter: free tier (50 req/day) is useless at our cadence; paid cheap models exist but nothing meaningfully cheaper than Luna's rates for this quality — not worth the extra hop now. Revisit only if real bills contradict projections.

## 8. Work log — every point, mapped

Each row traces to the 2026-09-24 discussion (S#) or the code-read findings (F#). Nothing is dropped.

| # | Point | Stage |
| --- | --- | --- |
| S1 | Jev = nervous system: recursive step-executor of a task/cycle | 2 |
| S2 | Luna = brain: direction-setting after task completion, max temperature | 3 |
| S3 | Luna call cap (~60/hr) with small, batched calls | 3 |
| S4 | Task = a cycle of Jev operations; brain consulted on completion | 2–3 |
| S5 | Environment/resources need RNG + their own behaviors, built explicitly | 1 |
| S6 | No state-hop map: real steps, walking, collecting, mining, building | 1 |
| S7 | Start with given houses/roads; all growth after must be earned | 1 |
| S8 | Use the downloaded asset packs (stones, farm plants verified in Downloads) | 1 |
| S9 | Find/download additional packs if needed (animals) | 1, 5 |
| S10 | Stage-by-stage; plan and log everything; no rushing | process |
| S11 | Base agent: personality, own memories, recurrence; compaction inside the agent, not a separate engine | 3–4 |
| S12 | Luna output is monotonous → eventful narration from real events | 3, 5 |
| S13 | Town log / town history UI (deaths, arrivals, what people did) | 5 |
| S14 | Original names for newborns | 3 |
| S15 | See what people are doing | 1–2 (step labels), 5 (UI) |
| S16 | No fixed routes; real movement | 1 |
| S17 | Animals with simple Jev behavior | 5 |
| S18 | Jev calls uncapped; current batch pattern is the base | 2 |
| S19 | Thoughts / implicit behavior defined by Luna; the rest is action | 3 |
| S20 | Jev: no communication authorship; small expression stamps; complex need-effect modeling | 2, 4 |
| S21 | Research GPT-6 Luna pricing; cheaper GPT-family or OpenRouter alternatives | 7 (done) |
| S22 | Cost projections tied to the designed architecture | 7 (done) |
| S23 | Use GLM 5.3 base + Sonnet(=GLM 5.3 Flash) subagents for visual/asset work | process (in use) |
| S24 | Pitch before implementing | this doc |
| F1 | Words must be able to do things (instrumental speech) | 3 |
| F2 | Decisions memoryless single picks → multi-step tasks | 2 |
| F3 | Economy is fake → physical goods, carrying, trade scenes | 1, 5 |
| F4 | World can't generate events → event layer | 5 |
| F5a | Telepathic jealousy bug → witnessing required | 3 |
| F5b | `bendTowardMatter` overrides Jev → mechanic deleted (intentions supersede) | 2 |
| F6 | Jev cadence math didn't close → longer steps + 6/6s batches | 2 |
| F7 | Doc drift: DESIGN.md stale; `gemini` naming for Luna → rewrite + rename | 6 |
| F8 | 1-minute days force 60 stories/hr and illegible motion → 24-min days + speed toggle | 1 (needs sign-off) |

## 9. Stages

Each stage is a deliverable Shreyash tests before the next begins. No commits without approval. CHANGELOG updated only at good-to-go.

- **Stage 0 — Sign-off.** This document. DoD: pitch approved, §9 open questions resolved. ✅
- **Stage 1 — Body.** ✅ **Built & gated.** Continuous grid map, terrain, walk mask, A*, walking; resource nodes with stages/depletion/regrowth/RNG scatter; carry inventory; physical household storage; construction sites (deliver → build stages → finished entity); weather Markov; time change.
- **Stage 2 — Spine.** ✅ **Built & gated.** Task/Step model; Jev step-question over legal steps; recursive executor; brainstem interrupts; stamp expressions; `bendTowardMatter` deleted.
- **Stage 3 — Brain.** ✅ **Built & gated.** Brain tick every ~3 real min under hard valves (60 calls/hr, 600k tok/hr); Luna contract (tasks, thoughts, memory lines, dialogue with typed acts, newborn naming); witnessing-based delivery; salience engine. Measured ≈ $0.0006/call.
- **Stage 4 — Base agent.** ✅ **Built & gated 2026-09-26.** Weighted episodic ring (cap 16, salience eviction, fade); dawn consolidation into ≤6 ledger beliefs; broken promises (favor >2 days) become slights; relevance-ranked `recallFor` in both spine and brain prompts; chronicle line for Luna; beliefs in dossiers. $0 new LLM cost.
- **Stage 5a — Animals & town life.** ✅ **Built 2026-09-26, awaiting gate.** Wildlife (3 crows, 2 deer, 1 town dog) with code instincts (fear/hunger FSM, night rest, crow berry-stealing witnessed in the log); laya local-model minds as env-gated experiment (`LAYA_URL` → SystemOne-compatible biases, legality-checked, instinct fallback, $0); event layer (storm windfall → +2 wood/household, illness — home confinement, comfort-cure or 2 days, ~18%/dawn spawn among adults/elders; festivals on build completion; vigil on death; naming rite warms guardians). 83/83 tests.
- **Stage 5b — Town history & trade.** ✅ **Built 2026-09-26, awaiting final review.** Barter at the market and raised stalls (complementary household stores → 2-for-2 swap, log line + speech + memory + bond); town-history panel with kind/person/today filters; visitors gate opened (`VISITORS_OPEN = true` — dock, endpoints, Firestore persistence were already built).
- **Stage 6 — Polish & ship, then pause.** ✅ **Shipped & paused 2026-09-26.** `gemini`→`luna` rename (zero `gemini` references in code), DESIGN.md rewritten for V2, README + CHANGELOG written, screenshots in `screenshots/`. Shreyash approved commit and called the pause: `MINDS_LIVE = false` in `src/world/gates.ts` disconnects every mind upstream of the call sites (spine, brain, laya, story — zero model calls with keys present, local and Vercel); `VISITORS_OPEN = false` closes the dock; the page carries the paused banner and a GitHub header link. 88/88 tests. Cost while paused: $0/day. Resume = two flags.

## 10. Open questions (blocking Stage 1)

1. **Time**: approve 1 tick = 1 in-world minute (24-min days, speed toggle)? Recommendation: yes.
2. **Map size / residents**: keep 18 residents on a ~120×68 grid? Recommendation: yes; revisit after Stage 1 play.
3. **Visitors**: stay gated off until after Stage 5? Recommendation: yes — scope control.
