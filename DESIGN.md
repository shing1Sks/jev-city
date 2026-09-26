# JEV City

A realtime town whose residents choose, speak, and remember. Eighteen residents, one-second ticks, a wildlife, a working economy of favors, and three minds with strictly separated jobs: Luna dreams, Jev decides, code keeps the law.

## The three minds

**Luna (GPT-6, temperature 1.0) is the brain — never the hands.** One call every three real minutes, under hard valves (60 calls an hour, 600k tokens an hour; past the budget the brainstem takes over). Her contract is typed and narrow:

- **tasks** — a label and a why for a rostered resident. She names the work; she never picks the steps.
- **thoughts and memory** — one inner line and one remembered line per person.
- **dialogue** — a line in her own words carrying a typed act: `request`, `give`, `invite`, `warn`, `comfort`, `thank`, `tease`. The act is executed by code; the words are hers. A request co-located becomes a real owed favor.
- **names** — newborns wait with a formula name until she names them; the rite warms the guardians.

Her prompt closes with an identity block as a drift anchor. Garbage output is dropped, never half-applied.

**Jev (TypeSafe SystemOne) is the spine.** One batched call of six agents every six seconds answers narrow typed questions: which legal step, whether to speak, to whom, how. It is deterministic, priced, and it never writes a sentence. Illegal choices are thrown away; low confidence falls back to the reflex.

**Code is the body and brainstem.** Time, weather, hunger, energy, walking, stores, growth, curfew, guardian duty, illness confinement, animal instincts. The law can replace a step the spine picked. With no keys set, the town runs entirely on the brainstem — poorer inner life, same physics.

## Time

One tick is one in-world minute; a day is 1,440 ticks, about 24 real minutes at 1× speed. Dawn 05–07, day 07–17, dusk 17–19, night 19–05. Weather steps every two hours through clear, cloudy, rain, wind, storm; storms sometimes fell a tree, and the windfall is shared — two wood to every household.

The world RNG is deterministic mulberry32, persisted with the save, so fortune continues across restarts.

## Memory

Every resident carries an episodic ring of sixteen memories with salience, polarity, and fade. Repeated episodes fold at dawn into at most six standing beliefs — ledgers, not prose. A favor Luna accepted that goes over two days stale fades unkept: the creditor records the slight, the debtor feels it, rivalry rises. Recall is scored by faded salience plus relevance (who is nearby, what the current task is about) and feeds both spine and brain prompts. Yesterday's public chronicle opens Luna's view of the town.

## The town

Eighteen seeded residents across households (see `cast.ts`), born as toddlers, aged in bands: toddler, child, youth, adult, elder. The law is hard where it must be — toddlers never walk alone, children carry no tools, the young are home by curfew, elders do not haul — and a preference (`Jevhold` custom in `rules.ts`) only where acts are otherwise close.

People build. Luna may set a project task; the town marks a site, hauls real materials, and raises it stage by stage. A finished build is a festival: every capable hand is invited to the square, and belonging rises.

## Illness and death

Most dawns nobody falls ill, but someone eventually does — one at a time, grown only. The ill keep to home and rest; hunger can still send them to the pantry. Comfort from another cures on the spot, or it passes after two days. A death is met with a vigil, and the town cools.

## Wildlife

Three crows, two deer, and one town dog live on the grid with fear and hunger. Instincts are code: crows strip ripe berry bushes the town would harvest (witnessed steals enter the log), deer keep their distance, the dog follows adults. A local model can live above these instincts: set `LAYA_URL` and a SystemOne-compatible endpoint receives per-animal questions every fifteen seconds; its urges land as biases honored only when legal for the species and feasible on the grid. Unreachable or nonsensical — the instincts simply carry on. Cost: zero.

## Trade

The market and every raised stall are trade spots. When two grown traders from different households stand together and their stores complement — one holds a surplus of what the other lacks — two units swap for two. The scene is real: a log line, a word spoken, a memory kept, a warmer bond.

## Visitors

The gate is open. A visitor takes a name, walks in at the square, wanders the town, and talks — the same closed lexicon residents fall back to, parsed for `@name` address and suggestions. Residents remember what is said to them. Ten visitors per address.

## Speech

Two registers. The reflex and visitors speak the closed lexicon — `WORD topic tone`, fifteen stamped tones — where every composition is legal by construction. Luna's lines are her own words, but what makes them causal is the typed act underneath, and private lines stay private: only the two present remember them.

## The story

Luna also narrates. On a slow, capped cadence she rewrites the town story from salient events — headline, body, three lines of gossip — plus each person's mood and inner note and the bond notes. She is told what was built and who visited, and forbidden from inventing more. The chronicle lives in `data/events.md`, restored from `data/inner.json` on restart. The old `gemini` name for this chip is retired: it is Luna, telemetry field `luna`.

## Town history

The log is a rolling eighty events — work, weather, law, meals, trades, build, life, speech — filterable in the web UI by kind, by person, and to today.

## Stack

Vite, React 18, Tailwind 4, and a Node server (SSE on 8787, web on 5173). TypeScript everywhere; tests run on `tsx` + `node:test` (`npm test`), types checked with `npm run check`. Town state, visitors, and per-address seats persist to Firestore; a Vercel batch endpoint (`api/stream.ts`) runs the town serverless with a lease, read-only streams for everyone else. The stage is drawn in absolutely positioned DOM and SVG, world units mapped directly to percent, so what you see is what the simulation knows.

## Running costs

Jev ≈ $0.85/day, Luna ≈ $0.27/day — about $1.10/day combined at stock cadence. The laya experiment is local and free; the story cadence is valve-capped. Nothing else spends.
