import { useEffect, useMemo, useRef, useState } from "react";
import { householdName } from "../world/cast.js";
import { INTENTS, TOPICS, TONES } from "../world/lexicon.js";
import { placeOf } from "../world/map.js";
import { lawLines } from "../world/rules.js";
import type { PlaceId, PublicPerson, PublicState } from "../world/types.js";
import { FEEL, LOOKS, PROPS, ROUTES, SPOTS, bodyScale } from "./village.js";

export function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [heardOpen, setHeardOpen] = useState(false);
  const [lexiconOpen, setLexiconOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const seen = useRef({ tick: -1, at: 0 });
  const fromPos = useRef<Record<string, { x: number; y: number }>>({});
  const toPos = useRef<Record<string, { x: number; y: number }>>({});
  const [now, setNow] = useState(0);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onmessage = (event) => {
      setState(JSON.parse(event.data) as PublicState);
      setOffline(false);
    };
    source.onerror = () => setOffline(true);
    return () => source.close();
  }, []);

  useEffect(() => {
    let frame = 0;
    const loop = (time: number) => {
      setNow(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (state && state.tick !== seen.current.tick) {
    const next: Record<string, { x: number; y: number }> = {};
    for (const person of state.people) next[person.id] = { x: person.x, y: person.y };
    fromPos.current = Object.keys(toPos.current).length === 0 ? next : toPos.current;
    toPos.current = next;
    seen.current = { tick: state.tick, at: now || performance.now() };
  }
  const glide = Math.min(1, Math.max(0, (now - seen.current.at) / 1000));

  const selected = state?.people.find((person) => person.id === selectedId) ?? null;
  const openLines = useMemo(
    () => (state?.log ?? []).filter((event) => event.kind === "speech" && event.audience !== "private").slice(-8).reverse(),
    [state],
  );

  async function post(path: string, body: unknown) {
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const phase = state?.phase ?? "day";
  const weather = state?.weather ?? "clear";

  return (
    <div className={`game ${phase} ${weather}`}>
      <header className="nav">
        <strong className="mark">JEV City</strong>
        <SkyClock hour={state?.hour ?? 7} minute={state?.minute ?? 0} phase={phase} clock={state?.clock ?? "--:--"} />
        <div className="nav-actions">
          {offline ? <span className="tag warn">Reconnecting</span> : null}
          <span className="tag">{state?.soul.mode === "jev" ? "JEV" : "Reflex"}{state?.soul.inFlight ? " ·" : ""}</span>
          <button type="button" onClick={() => void post("/api/soul", { mode: state?.soul.mode === "jev" ? "reflex" : "jev" })}>
            {state?.soul.mode === "jev" ? "Reflex" : "JEV"}
          </button>
          <button
            type="button"
            onClick={() => {
              const next = !paused;
              setPaused(next);
              void post("/api/pause", { paused: next });
            }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button type="button" aria-expanded={heardOpen} onClick={() => { setHeardOpen((open) => !open); setSelectedId(null); }}>
            Heard
          </button>
        </div>
      </header>

      <main
        className="stage"
        ref={stageRef}
        onClick={() => {
          setSelectedId(null);
          setHeardOpen(false);
        }}
      >
        <div className="scene">
          <svg className="paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {ROUTES.map(([from, to]) => (
              <line key={`${from}-${to}`} x1={SPOTS[from].x} y1={SPOTS[from].y} x2={SPOTS[to].x} y2={SPOTS[to].y} />
            ))}
          </svg>
          {PROPS.map((prop) => (
            <img
              key={`${prop.src}-${prop.x}-${prop.y}`}
              className="prop"
              src={prop.src}
              alt=""
              style={{ left: `${prop.x}%`, top: `${prop.y}%`, width: `${prop.w}%` }}
            />
          ))}
          {(Object.keys(SPOTS) as PlaceId[]).map((id) => (
            <span key={id} className="place" style={{ left: `${SPOTS[id].x}%`, top: `${SPOTS[id].y - 6}%` }}>
              {placeOf(id).name}
            </span>
          ))}
          <div className="veil" />
          {weather === "rain" ? <div className="rain" /> : null}
          {state?.expansions.map((item) => (
            <span key={item.id} className="mark-own" style={{ left: `${item.x}%`, top: `${item.y}%` }} title={item.label}>
              {item.kind}
            </span>
          ))}
          {state?.people.map((person) => (
            <PersonSprite
              key={person.id}
              person={person}
              people={state.people}
              from={fromPos.current[person.ledBy ?? person.id]}
              glide={glide}
              now={now}
              selected={person.id === selectedId}
              revealPrivate={person.id === selectedId || person.speech?.listenerId === selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setHeardOpen(false);
              }}
            />
          ))}
        </div>

        {state?.story ? (
          <section className="story" aria-live="polite">
            <p>In the town{paused ? " · paused" : ""}{state.story.at ? ` · ${state.story.at}` : ""}</p>
            <h2>{state.story.headline}</h2>
            <p>{state.story.body}</p>
            {state.story.gossip.length > 0 ? (
              <ul>
                {state.story.gossip.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {heardOpen ? (
          <section className="popover heard" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>Heard in the open</h2>
              <button type="button" onClick={() => setHeardOpen(false)}>Close</button>
            </header>
            {openLines.length === 0 ? <p>The square is quiet.</p> : null}
            {openLines.map((event) => (
              <p key={event.id}><span>{event.clock}</span> {event.text}</p>
            ))}
            {state?.chronicle ? <p className="chronicle">{state.chronicle}</p> : null}
            <button type="button" onClick={() => setLexiconOpen((open) => !open)}>
              {lexiconOpen ? "Hide lexicon" : "Lexicon"}
            </button>
            {lexiconOpen ? (
              <div className="lexicon">
                <p>{INTENTS.map((item) => item.id).join(" · ")}</p>
                <p>{TOPICS.map((item) => item.id).join(" · ")}</p>
                <p>{TONES.map((item) => `${item.emoji} ${item.id}`).join("  ")}</p>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <aside className={selected ? "drawer open" : "drawer"} onClick={(event) => event.stopPropagation()}>
        {selected && state ? (
          <Dossier
            person={selected}
            state={state}
            onClose={() => setSelectedId(null)}
            onCompact={() => void post("/api/compact", {})}
          />
        ) : null}
      </aside>
    </div>
  );
}

function pointOf(person: PublicPerson): { x: number; y: number } {
  const spot = SPOTS[person.place] ?? { x: 50, y: 50 };
  return {
    x: Number.isFinite(person.x) ? person.x : spot.x,
    y: Number.isFinite(person.y) ? person.y : spot.y,
  };
}

function drawAt(person: PublicPerson, people: PublicPerson[], from: { x: number; y: number } | undefined, glide: number): { x: number; y: number } {
  const leader = person.ledBy ? people.find((other) => other.id === person.ledBy) : null;
  const subject = leader ?? person;
  const here = pointOf(subject);
  const origin = from && Number.isFinite(from.x) && Number.isFinite(from.y) ? from : here;
  const x = origin.x + (here.x - origin.x) * glide;
  const y = origin.y + (here.y - origin.y) * glide;
  return leader ? { x: x + 1.5, y: y + 0.9 } : { x, y };
}

function PersonSprite({
  person,
  people,
  from,
  glide,
  now,
  selected,
  revealPrivate,
  onSelect,
}: {
  person: PublicPerson;
  people: PublicPerson[];
  from: { x: number; y: number } | undefined;
  glide: number;
  now: number;
  selected: boolean;
  revealPrivate: boolean;
  onSelect: (id: string) => void;
}) {
  const spot = drawAt(person, people, from, glide);
  const look = LOOKS[person.id] ?? { pack: "goblin" as const, who: "male" as const, hue: 0 };
  const facing = person.facing || "front";
  const dir = facing.charAt(0).toUpperCase() + facing.slice(1);
  const scale = bodyScale(person.band);
  const listener = person.speech?.listenerId ? people.find((other) => other.id === person.speech?.listenerId) : null;
  const privateLine = person.speech?.audience === "private";
  const showWords = !privateLine || revealPrivate;
  const frame = Math.floor(now / 110) % 8;

  return (
    <button
      type="button"
      className={`actor ${selected ? "selected" : ""} ${person.moving ? "moving" : ""}`}
      style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${4.1 * scale}%` }}
      data-person={person.id}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(person.id);
      }}
    >
      {look.pack === "valkyrie" ? (
        <img
          className={facing === "left" ? "flip" : ""}
          src={`/craft/valkyrie/walk-${person.moving ? frame : 0}.png`}
          alt=""
          draggable={false}
        />
      ) : (
        <i
          className={`${look.pack} ${person.moving && look.pack === "goblin" ? "walk" : "idle"}`}
          style={{
            backgroundImage: `url("${sheetUrl(look, dir, person.moving)}")`,
            filter: look.pack === "goblin" ? `hue-rotate(${look.hue}deg)` : undefined,
          }}
        />
      )}
      <b>{person.name}</b>
      <small>
        {person.doing || "here"}
        {person.feeling && person.feeling !== "content" ? ` · ${FEEL[person.feeling] ?? person.feeling}` : ""}
      </small>
      {person.speech ? (
        <em>
          {showWords
            ? `${privateLine && listener ? `to ${listener.name}: ` : ""}${person.speech.text}`
            : privateLine && listener
              ? `quietly, to ${listener.name}`
              : person.speech.text}
        </em>
      ) : null}
    </button>
  );
}

function sheetUrl(look: Extract<typeof LOOKS[string], { pack: "goblin" | "boss" }>, dir: string, moving: boolean): string {
  if (look.pack === "boss") return `/craft/boss/${look.who}-${dir}-Idle.png`;
  return `/craft/goblin/${look.who}-${dir}---${moving ? "Walking" : "Idle"}.png`;
}

function SkyClock({ hour, minute, phase, clock }: { hour: number; minute: number; phase: string; clock: string }) {
  const h = hour + minute / 60;
  const day = h >= 6 && h < 18;
  const span = day ? (h - 6) / 12 : h >= 18 ? (h - 18) / 12 : (h + 6) / 12;
  const x = span * 100;
  const y = Math.sin(span * Math.PI) * 100;
  return (
    <div className={`sky ${day ? "day" : "night"}`} data-clock={clock}>
      <div className="dial" aria-hidden="true">
        <i className={day ? "sun" : "moon"} style={{ left: `${x}%`, bottom: `${y * 0.72}%` }} />
      </div>
      <p>
        <strong>{clock}</strong>
        <span>{phase}</span>
      </p>
    </div>
  );
}

function Dossier({
  person,
  state,
  onClose,
  onCompact,
}: {
  person: PublicPerson;
  state: PublicState;
  onClose: () => void;
  onCompact: () => void;
}) {
  const bonds = state.bonds
    .filter((bond) => bond.a === person.id || bond.b === person.id)
    .sort((left, right) => right.score - left.score);
  const privateLines = state.log
    .filter((event) => event.audience === "private" && (event.speakerId === person.id || event.listenerId === person.id))
    .slice(-6)
    .reverse();

  return (
    <>
      <header>
        <div>
          <p>{householdName(person.household)}</p>
          <h2>{person.name}</h2>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <p className="meta">{person.age} · {person.gender} · {person.band} · {placeOf(person.place).name}</p>
      <p className="doing">{person.doing}{person.because ? ` — ${person.because}` : ""}</p>
      <p className="mood">{person.mood}</p>
      {person.self.ambition ? (
        <>
          <p>{person.self.ambition.passion}</p>
          <p className="quiet">Plan: {person.self.ambition.plan}</p>
          <p className="quiet">Likes {person.self.ambition.likes}. Dislikes {person.self.ambition.dislikes}.</p>
        </>
      ) : null}
      <p>{person.innerNote}</p>
      <dl>
        <div><dt>Temper</dt><dd>{person.self.temper}</dd></div>
        <div><dt>Wants</dt><dd>{person.self.want}</dd></div>
        <div><dt>Fears</dt><dd>{person.self.fear}</dd></div>
        <div><dt>Habit</dt><dd>{person.self.habit}</dd></div>
      </dl>
      <Meter label="Hunger" value={person.hunger} />
      <Meter label="Energy" value={person.energy} />
      <Meter label="Belonging" value={person.belonging} />
      <p className="store">Larder {state.food[person.household] ?? 0}</p>
      <h3>Said in private</h3>
      {privateLines.length === 0 ? <p className="quiet">Nothing sealed yet.</p> : null}
      {privateLines.map((event) => <p key={event.id}><span>{event.clock}</span> {event.text}</p>)}
      <h3>Bonds</h3>
      <ul>
        {bonds.map((bond) => {
          const otherId = bond.a === person.id ? bond.b : bond.a;
          const other = state.people.find((item) => item.id === otherId);
          return <li key={`${bond.a}-${bond.b}`}><b>{other?.name ?? otherId}</b> {bond.score} — {bond.note}</li>;
        })}
      </ul>
      <details>
        <summary>Law</summary>
        <ul>
          {lawLines(person).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </details>
      <button type="button" onClick={onCompact}>Compact memory</button>
      <p className="quiet">Town, farm, and people tiles by Kenney.</p>
      {state.gemini.lastError ? <p className="quiet">{state.gemini.lastError}</p> : null}
      {state.soul.lastError ? <p className="quiet">{state.soul.lastError}</p> : null}
    </>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <label className="meter">
      <span>{label}</span>
      <i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
    </label>
  );
}
