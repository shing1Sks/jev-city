# JEV City

A small town of ten residents you can watch. The world ticks once a second. Law is ordinary code. When someone must choose, [JEV](https://typesafe.ai) picks among the legal acts and a fixed lexicon. GPT-6 Luna writes the public story: gossip, weather, love, and the work people are trying to make their own.

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

Names only are listed in `env.manifest`. The key file is gitignored.

Pause stops the clock for everyone watching. Heard opens what was said in the open. The card on the map is the story visitors read. Click a person for their temper, passion, plan, likes, and private lines.

## What the residents can change

Each person has a passion, a love, likes and dislikes, and a plan. Repeating the work that matches that plan leaves a mark on the map: a garden, an orchard, a stall, a shrine, or a watch. The story card picks up gossip and those marks. Luna is asked about once a minute, and never more than 60 times an hour.

## Cost

JEV is treated as free here. GPT-6 Luna lists at **$0.10 per million input tokens** and **$0.50 per million output tokens** (short context, September 2026).

A story call is kept small: on the order of 3,000 input tokens and 500 output tokens, with reasoning set low. At the cap of 60 calls an hour that is about **3 cents an hour**. If the model still spends a couple thousand thinking tokens, it is closer to **10 cents an hour**. Left running all day, that is roughly **$0.70 to $2.50**. A free-tier key can be $0 until the allowance runs out.

## Layout

- `src/world` — map, cast, law, lexicon, tick
- `src/server` — tick loop, JEV, Luna story, chronicle
- `src/web` — the town view
- `DESIGN.md` — the rules the town is built on

## Art

Town props are from Craftpix's free summer tileset. People are mixed from Craftpix's free top-down goblin, boss, and valkyrie packs, plus a few rocks from the free stone pack. Those packs are free for use in projects under Craftpix's license. Code in this repository is MIT.

## License

MIT. See `LICENSE`.
