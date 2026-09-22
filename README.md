# JEV City

A small town of eighteen residents you can watch. The world ticks once a second. Law is ordinary code. When someone must choose, [JEV](https://typesafe.ai) picks among the legal acts and a fixed lexicon. GPT-6 Luna writes the public story: gossip, weather, love, and the work people are trying to make their own.

## Run

```powershell
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5173. The world server is http://127.0.0.1:8787.

Copy `.env.example` to `.env` and fill in:

- `TYPESAFE_API_KEY` for JEV
- `OPENAI_API_KEY` for the town story (`gpt-6-luna`)
- `FIREBASE_PROJECT_ID` and `FIREBASE_API_KEY` so the town, its visitors, and the visitor log survive a restart

Names only are listed in `env.manifest`. The key file is gitignored.

The card on the map is the day's record. Click a person for their temper, passion, plan, likes, and private lines. A subtitle over a speaker shows who they are talking to, the tone, and the words. Hover a person to see what they are doing.

## Visitors

Visitor entry is off. `VISITORS_OPEN` in `src/world/gates.ts` is `false`, and `POST /api/visit/enter` refuses new arrivals. The talk grammar is already in the server for when that door opens again:

- `@all` is an announcement
- `@Name` is one person
- `@@ Name Name Name` reaches up to three people
- Suggest marks the line as something they might take up

Ten visitors from one address. Firestore is set up to hold `town/state`, `visitors`, `visitorLog`, and `ipSeats` once `firestore.rules` is published. A Vercel deploy cannot keep an indefinite one-second clock alive inside a serverless function, so the batch runner below bounds each run. Firestore keeps the town between runs.

## Vercel batch runner

The Vercel deployment can also run the town in bounded batches. `/api/stream` owns a Firestore lease, advances 120 ticks (two in-world days; each tick is 24 in-world minutes) over about two real minutes, saves the full world, and releases the lease. The browser reconnects for the next batch while it remains open. Other viewers receive read-only snapshots while a batch is running.

Set `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `TYPESAFE_API_KEY`, and `OPENAI_API_KEY` in Vercel. The Firestore rules must allow the server's state and lease writes; do not leave the collections anonymously writable for a public deployment.

## What the residents can change

Each person has a passion, a love, likes and dislikes, and a plan. Repeating the work that matches that plan leaves a mark on the map: a garden, an orchard, a stall, a shrine, or a watch. The story card picks up gossip and those marks. A village day lasts about one real minute. Luna writes one daily summary per day, and never more than 100 times an hour.

## Cost

JEV is not priced here. The bill that grows while the town runs is GPT-6 Luna, one story at the end of each village day.

A village day is about one real minute, so a town left on makes about **60 story calls an hour**. The server also refuses a 61st call inside 45 seconds and stops at **100 calls an hour**. Ordinary play stays near 60, not 100.

[OpenAI's API prices](https://developers.openai.com/api/docs/pricing) for `gpt-6-luna`, short context, September 2026: **$0.10 per million input tokens** and **$0.50 per million output tokens**.

| What you assume | Per call | Per hour | Per day | Per 30 days |
| --- | --- | --- | --- | --- |
| 3,000 in, 800 out | $0.0007 | 4¢ | $1.00 | $30 |
| 4,000 in, 2,000 out (the completion cap) | $0.0014 | 8¢ | $2.00 | $61 |
| Same size, but at the 100-call cap | $0.0014 | 14¢ | $3.40 | $100 |

Reasoning tokens are billed as output. If Luna spends a lot of them, the middle row can about triple, toward **25¢ an hour** and about **$180 a month**. A free-tier key stays at $0 until the allowance runs out. Firebase writes for this town fit the free Spark plan. The static page can sit on Vercel; the clock has to stay on a machine that does not sleep.

## Layout

- `src/world` — map, cast, law, lexicon, tick
- `src/server` — tick loop, JEV, Luna story, chronicle
- `src/web` — the town view, on [shadcn/ui](https://ui.shadcn.com)
- `DESIGN.md` — the rules the town is built on

## Art

Town props are from Craftpix's free summer tileset. People are mixed from Craftpix's free top-down goblin, boss, and valkyrie packs, plus a few rocks from the free stone pack. Those packs are free for use in projects under Craftpix's license. Code in this repository is MIT.

## License

MIT. See `LICENSE`.
