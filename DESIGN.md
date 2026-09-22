# JEV City

A realtime town whose residents choose, speak, and remember. The base is ten people, a one-second tick, a closed lexicon, and two models with different jobs.

## The split

JEV (TypeSafe System One) does not write prose and does not run the clock. It answers narrow typed questions: which legal act, whether to speak, whether that speech is private or public, and which lexicon word, topic, and tone. Code throws away anything illegal.

Gemini (`gemini-flash-latest`) does not pick the next act. On a slow cadence, and when you press Compact memory, it rewrites:

- each person's mood and the sentence they are carrying
- bond notes between pairs
- the public town memory

Private lines stay out of the public paragraph. Their meaning goes into the pair's bond note. The file is `data/events.md`. A restart reloads moods and bonds from `data/inner.json`.

The world itself is code: time, weather, hunger, energy, walking, stores, curfew, and the duty to a toddler. That is the part that must not drift.

## Time

One real second is ten minutes in town. The day starts at 07:00.

- Dawn 05:00–07:00
- Day 07:00–17:00
- Dusk 17:00–19:00
- Night 19:00–05:00

Weather steps every four hours through clear, cloudy, rain, and wind. Rain makes outdoor work less attractive and costs energy away from shelter. Meal bells ring at 08:00, 13:00, and 19:00. They are news, not a forced animation. People still choose to eat.

JEV is called when someone has finished their current act. Calls are batched, at most one batch every eight seconds, so a tick never waits on the network and the key is not spent on every second. While a call is queued they stand and the dossier says thinking. Low confidence falls back to the reflex policy. Work itself lasts several seconds of real time. Walking stays quicker.

## The ten

| Name | Age | Household | Place in the town |
| --- | --- | --- | --- |
| Jevaary | 38 | Vale, spouse of Jevine | Field, haul, watch. Counts food before he speaks. |
| Jevine | 36 | Vale, spouse of Jevaary | Hearth and the children. Says a name when she speaks. |
| Jevlin | 9 | Vale, their son | Wants to carry something heavy. Turns chores into play. |
| Jevora | 6 | Vale, their daughter | Stays near Jevine. Repeats the last kind word. |
| Jevoric | 67 | Porch, Jevina's grandfather | Teaches. Answers a question with a question. |
| Jevina | 16 | Porch, his apprentice | Wants a real task. Offers help before she is asked. |
| Jevon | 42 | Market, spouse of Jevara | The loft. Greets before he asks. |
| Jevara | 29 | Market, mother of Jevik | Cloth and the toddler. Speaks softly, then once more. |
| Jevik | 3 | Market, their son | One word and a point. Loud when left. |
| Jevella | 23 | Grove, on her own | Forage and healing. Weather before feelings. |

Each person has a temper, a want, a fear, a habit, skills, a mood, and an inner note. Those go into JEV's state so the same legal list still produces different choices. Gemini is what keeps the mood and the note from flattening into the seed text.

Bonds start from family and a few neighbor ties. Speech moves the score. Gemini rewrites the sentence attached to the score.

## Law

Bands are hard. Custom is a preference JEV and the reflex can weigh. Custom never deletes an act.

- **Toddler (0–4).** Cannot walk the town alone. Speech is a few words. If no household youth or adult is with them, they cry, and the nearest capable person in that household must come. At night that person brings them home.
- **Child (5–12).** Play, lessons, and two light gathering chores a day. No tools, hauling, or watch. Home by night unless a guardian is there.
- **Youth (13–17).** Apprentice work. No heavy haul, no night watch, no town-wide announcement. Home or the elder porch by night.
- **Adult (18–59).** Full work, care, and the watch. May announce to the whole town from the square. May speak in private.
- **Elder (60+).** No field labor, hauling, or watch. Teaching and counsel come first. May announce from the square.

Jevhold custom, when two acts are close: men lean to field, haul, and watch; women lean to hearth, mending, healing, forage, and care. Among children, outdoor chores lean toward boys and hearth chores toward girls. A clearly stronger skill outweighs the lean. The lean is data in `rules.ts`.

Guardians are household facts, not a mood. Jevaary and Jevine answer for Jevlin and Jevora. Jevon and Jevara answer for Jevik. Jevoric answers for Jevina.

## Speech

They do not generate sentences. An utterance is three closed choices:

`WORD topic tone`

Words: greet, bye, yes, no, maybe, need, want, have, give, come, go, stay, stop, help, look, tell, ask, like, dislike, fear, thanks, sorry, play, work, rest, eat, danger, safe.

Topics: food, water, home, bed, work, rest, child, rain, sun, crop, wood, cloth, hurt, friend, path, night, play, tool, help, family.

Tones are the fifteen stamps (joy, soft, sad, angry, fear, love, please, urgent, ask, tired, hunger, yes, no, rain, guard), each with one emoji.

Toddlers and children have smaller lists. Code rejects a word outside the speaker's list.

Audience is its own choice:

- **private** — one person in the same place. Only those two remember the words. The map shows a seal until you select one of them.
- **here** — everyone in that place.
- **town** — an announcement. Adults and elders, and only from the square.

`NEED food 🍽️` said in private to a spouse is a different event from the same line announced at the square. Both are legal compositions of the same lexicon.

## Places

Grove, field, well, Vale cottage, square, hearth, market loft, elder porch. People walk the paths between them. A toddler does not walk alone. A guardian walking home can bring a toddler who is with them.

Stores are per household. Farming, foraging, and hauling fill the larder. Eating spends it.

## What this base leaves for later

More places, seasons, trade prices, sickness, a new resident, a richer lexicon, and letting Gemini's bond notes change who is willing to speak in private. The tick, the law, and the two channels (open and sealed) are the parts the rest should plug into.

## Stack

Vite, React, and a Node server. JEV's SDK is JavaScript, so the server is Node rather than FastAPI. The town view is drawn in SVG and CSS, original to this project, so positions and speech stamps stay tied to the simulation. No database: ten people fit in memory, with the chronicle on disk.
