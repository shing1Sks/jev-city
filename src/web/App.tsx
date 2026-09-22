import { useEffect, useRef, useState } from "react";
import { householdName } from "../world/cast.js";
import { VISITORS_OPEN } from "../world/gates.js";
import { INTENTS, TOPICS, TONES } from "../world/lexicon.js";
import { placeOf } from "../world/map.js";
import { lawLines } from "../world/rules.js";
import type { Expansion, PlaceId, PublicPerson, PublicState } from "../world/types.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Progress } from "./components/ui/progress.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Separator } from "./components/ui/separator.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./components/ui/sheet.js";
import { FEEL, LOOKS, PROPS, ROUTES, SPOTS, WORKS, bodyScale } from "./village.js";
import { VisitDock, VisitorSprite, readSession, type VisitSession } from "./visit.js";

export function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(true);
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState<VisitSession | null>(() => readSession());
  const [addressIds, setAddressIds] = useState<string[]>([]);
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
    for (const visitor of state.visitors ?? []) next[visitor.id] = { x: visitor.x, y: visitor.y };
    fromPos.current = Object.keys(toPos.current).length === 0 ? next : toPos.current;
    toPos.current = next;
    seen.current = { tick: state.tick, at: now || performance.now() };
  }
  const glide = Math.min(1, Math.max(0, (now - seen.current.at) / 1000));
  const laid = layoutActors(state, fromPos.current, glide);
  const laidWorks = spreadWorks(state?.expansions ?? []);

  const selected = state?.people.find((person) => person.id === selectedId) ?? null;
  const phase = state?.phase ?? "day";
  const weather = state?.weather ?? "clear";

  return (
    <div className={`game flex h-full flex-col bg-background ${phase} ${weather}`}>
      <header className="z-20 flex h-12 shrink-0 items-center gap-4 border-b bg-background/95 px-4">
        <strong className="font-serif text-base font-medium tracking-tight">JEV City</strong>
        <SkyClock hour={state?.hour ?? 7} minute={state?.minute ?? 0} phase={phase} clock={state?.clock ?? "--:--"} />
        {offline ? <Badge variant="destructive" className="ml-auto">Reconnecting</Badge> : null}
      </header>

      <main
        className="stage"
        ref={stageRef}
        onClick={() => setSelectedId(null)}
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
          {state?.expansions.map((item) => {
            const at = laidWorks[item.id] ?? item;
            const look = WORKS[item.kind] ?? WORKS.garden;
            return (
              <span key={item.id} className="work" style={{ left: `${at.x}%`, top: `${at.y}%`, width: `${look?.w ?? 4}%` }} title={item.label}>
                <img src={look?.src} alt="" draggable={false} />
                <b>{item.label}</b>
              </span>
            );
          })}
          {state?.people.filter((person) => person.alive !== false).map((person) => (
            <PersonSprite
              key={person.id}
              person={person}
              people={state.people}
              at={laid[person.id]}
              now={now}
              selected={person.id === selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                setAddressIds([id]);
              }}
            />
          ))}
          {(state?.visitors ?? []).map((visitor) => (
            <VisitorSprite
              key={visitor.id}
              visitor={visitor}
              at={laid[visitor.id]}
              moving={Math.hypot(visitor.x - (fromPos.current[visitor.id]?.x ?? visitor.x), visitor.y - (fromPos.current[visitor.id]?.y ?? visitor.y)) > 0.4}
              onPick={() => undefined}
            />
          ))}
        </div>

        {state?.story ? (
          <Card
            className={`absolute z-20 max-h-[40vh] overflow-auto border-primary/30 bg-card/95 shadow-lg ${storyOpen ? "bottom-3 left-3 w-[min(26rem,calc(100%-1.5rem))] max-md:top-2 max-md:bottom-auto" : "bottom-3 left-3 w-auto border-0 bg-transparent shadow-none"}`}
            aria-live="polite"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="p-3 pb-0">
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => setStoryOpen((open) => !open)}>
                {storyOpen ? "Hide" : "Story"}
              </Button>
            </CardHeader>
            {storyOpen ? (
              <CardContent className="px-4 pt-2 pb-4">
                {state.story.day && state.story.headline ? (
                  <>
                    <CardDescription>
                      {state.story.at === "end of day" ? `End of day ${state.story.day}` : `Day ${state.story.day}, so far`}
                    </CardDescription>
                    <CardTitle className="mt-1">{state.story.headline}</CardTitle>
                    <p className="mt-2 text-sm leading-relaxed">{state.story.body}</p>
                    {state.story.gossip.length > 0 ? (
                      <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                        {state.story.gossip.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <CardDescription>Day {state.day} is still open. The record is written at midnight, about the day that just ended.</CardDescription>
                )}
              </CardContent>
            ) : null}
          </Card>
        ) : null}

        {VISITORS_OPEN ? (
          <VisitDock
            state={state}
            session={session}
            setSession={setSession}
            addressIds={addressIds}
            setAddressIds={setAddressIds}
          />
        ) : null}
      </main>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent onClick={(event) => event.stopPropagation()}>
          {selected && state ? <Dossier person={selected} state={state} /> : null}
        </SheetContent>
      </Sheet>
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

function spreadWorks(items: Expansion[]): Record<string, { x: number; y: number }> {
  const placed: { x: number; y: number }[] = [];
  const laid: Record<string, { x: number; y: number }> = {};
  for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
    let x = item.x;
    let y = item.y;
    let tries = 0;
    while (placed.some((other) => Math.hypot(other.x - x, other.y - y) < 7) && tries < 8) {
      const turn = (tries + 1) * 1.1;
      const ring = 7 + tries * 0.4;
      x = Math.max(8, Math.min(92, item.x + Math.cos(turn) * ring));
      y = Math.max(12, Math.min(88, item.y + Math.sin(turn) * ring * 0.75));
      tries += 1;
    }
    placed.push({ x, y });
    laid[item.id] = { x, y };
  }
  return laid;
}

function layoutActors(
  state: PublicState | null,
  from: Record<string, { x: number; y: number }>,
  glide: number,
): Record<string, { x: number; y: number }> {
  if (!state) return {};
  const spots = [
    ...state.people.filter((person) => person.alive !== false).map((person) => ({
      id: person.id,
      ...drawAt(person, state.people, from[person.ledBy ?? person.id], glide),
    })),
    ...(state.visitors ?? []).map((visitor) => {
      const here = {
        x: Number.isFinite(visitor.x) ? visitor.x : 52,
        y: Number.isFinite(visitor.y) ? visitor.y : 56,
      };
      const origin = from[visitor.id] && Number.isFinite(from[visitor.id]?.x) ? from[visitor.id] : here;
      return {
        id: visitor.id,
        x: (origin?.x ?? here.x) + (here.x - (origin?.x ?? here.x)) * glide,
        y: (origin?.y ?? here.y) + (here.y - (origin?.y ?? here.y)) * glide,
      };
    }),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const placed: { x: number; y: number }[] = [];
  const laid: Record<string, { x: number; y: number }> = {};
  for (const spot of spots) {
    let x = spot.x;
    let y = spot.y;
    let tries = 0;
    while (placed.some((other) => Math.hypot(other.x - x, other.y - y) < 5.4) && tries < 10) {
      const turn = (tries + 1) * 0.95;
      const ring = 5.4 + tries * 0.25;
      x = Math.max(4, Math.min(96, spot.x + Math.cos(turn) * ring));
      y = Math.max(8, Math.min(92, spot.y + Math.sin(turn) * ring * 0.7));
      tries += 1;
    }
    placed.push({ x, y });
    laid[spot.id] = { x, y };
  }
  return laid;
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
  at,
  now,
  selected,
  onSelect,
}: {
  person: PublicPerson;
  people: PublicPerson[];
  at: { x: number; y: number } | undefined;
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const spot = at ?? pointOf(person);
  const look = LOOKS[person.id] ?? { pack: "goblin" as const, who: "male" as const, hue: 0 };
  const facing = person.facing || "front";
  const dir = facing.charAt(0).toUpperCase() + facing.slice(1);
  const scale = bodyScale(person.band);
  const listener = person.speech?.listenerId ? people.find((other) => other.id === person.speech?.listenerId) : null;
  const line = person.speech ? readLine(person.speech.text) : null;
  const address = person.speech
    ? person.speech.audience === "private"
      ? `to ${listener?.name ?? "someone"}`
      : person.speech.audience === "town"
        ? "to the town"
        : "to those here"
    : "";
  const frame = Math.floor(now / 110) % 8;
  const feeling = FEEL[person.feeling] ?? person.feeling;

  return (
    <button
      type="button"
      className={`actor ${selected ? "selected" : ""} ${person.moving ? "moving" : ""} ${person.speech ? "speaking" : ""}`}
      style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${4.1 * scale}%` }}
      data-person={person.id}
      aria-pressed={selected}
      aria-label={person.speech ? `${person.name}, ${address}, ${line?.what ?? ""}` : person.name}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(person.id);
      }}
    >
      {person.speech && line ? (
        <span className="subtitle">
          <span className="how">{[address, line.how].filter(Boolean).join(" · ")}</span>
          <span className="what">{line.what}</span>
        </span>
      ) : null}
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
      <b>
        {person.feeling !== "content" ? <span className={`dot ${person.feeling}`} /> : null}
        {person.name}
      </b>
      <span className="caption">
        <strong>{person.name}</strong>
        <span>{person.doing || "here"}</span>
        {person.matter ? <span className="how">{matterLine(person.matter)}</span> : null}
        <span className="how">{feeling}</span>
      </span>
    </button>
  );
}

function matterLine(matter: NonNullable<PublicPerson["matter"]>): string {
  const aim = matter.kind === "court"
    ? `closer to ${matter.withName}`
    : matter.kind === "teach"
      ? `teaching ${matter.withName}`
      : matter.kind === "rival"
        ? `keeping up with ${matter.withName}`
        : `thawing toward ${matter.withName}`;
  const step = matter.step <= 0 ? "not yet spoken" : matter.step === 1 ? "spoke once" : "spoke again";
  return `${aim} · ${step}`;
}

function readLine(text: string): { what: string; how: string } {
  const parts = text.trim().split(/\s+/);
  const tone = TONES.find((item) => parts.includes(item.emoji));
  const words = parts.filter((part) => part !== tone?.emoji);
  const intent = INTENTS.find((item) => item.id === words[0]?.toLowerCase());
  const topic = TOPICS.find((item) => item.id === words[1]?.toLowerCase());
  if (!intent) return { what: text, how: tone ? `${tone.label} ${tone.emoji}` : "" };
  const what = topic ? `${intent.label} ${topic.label}` : intent.label;
  return { what, how: tone ? `${tone.label} ${tone.emoji}` : "" };
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
}: {
  person: PublicPerson;
  state: PublicState;
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
      <SheetHeader>
        <p className="text-xs tracking-widest text-primary uppercase">{householdName(person.household)}</p>
        <SheetTitle>{person.name}</SheetTitle>
        <SheetDescription>
          {person.age} · {person.gender} · {person.band} · {placeOf(person.place).name}
        </SheetDescription>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1 pr-3">
        <div className="space-y-4 pb-6">
          <p className="text-sm">{person.doing}{person.because ? ` — ${person.because}` : ""}</p>
          {person.matter ? <p className="text-sm text-primary">{matterLine(person.matter)}</p> : null}
          <p className="font-serif text-lg leading-snug">{person.mood}</p>
          {person.self.ambition ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="text-foreground">{person.self.ambition.passion}</p>
              <p>Plan: {person.self.ambition.plan}</p>
              <p>Likes {person.self.ambition.likes}. Dislikes {person.self.ambition.dislikes}.</p>
            </div>
          ) : null}
          <p className="text-sm">{person.innerNote}</p>
          <Separator />
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Temper</dt><dd>{person.self.temper}</dd>
            <dt className="text-muted-foreground">Wants</dt><dd>{person.self.want}</dd>
            <dt className="text-muted-foreground">Fears</dt><dd>{person.self.fear}</dd>
            <dt className="text-muted-foreground">Habit</dt><dd>{person.self.habit}</dd>
          </dl>
          <Meter label="Hunger" value={person.hunger} />
          <Meter label="Energy" value={person.energy} />
          <Meter label="Belonging" value={person.belonging} />
          <p className="text-xs text-muted-foreground">
            Food {state.food[person.household] ?? 0} · wood {state.wood?.[person.household] ?? 0} · stone {state.stone?.[person.household] ?? 0} · cloth {state.cloth?.[person.household] ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">Authority {person.authority ?? 0} · bricks {person.bricks ?? 0}/6</p>
          <Separator />
          <h3 className="text-sm font-medium">Said aside</h3>
          {privateLines.length === 0 ? <p className="text-sm text-muted-foreground">No private lines yet.</p> : null}
          {privateLines.map((event) => (
            <p key={event.id} className="text-sm"><span className="mr-2 text-muted-foreground tabular-nums">{event.clock}</span>{event.text}</p>
          ))}
          <h3 className="text-sm font-medium">Bonds</h3>
          <ul className="space-y-1 text-sm">
            {bonds.map((bond) => {
              const otherId = bond.a === person.id ? bond.b : bond.a;
              const other = state.people.find((item) => item.id === otherId);
              return <li key={`${bond.a}-${bond.b}`}><span className="font-medium">{other?.name ?? otherId}</span> {bond.score} — {bond.note}</li>;
            })}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm">Law</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              {lawLines(person).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </details>
          {state.gemini.lastError ? <p className="text-xs text-destructive">{state.gemini.lastError}</p> : null}
          {state.soul.lastError ? <p className="text-xs text-destructive">{state.soul.lastError}</p> : null}
        </div>
      </ScrollArea>
    </>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <label className="grid grid-cols-[5.5rem_1fr] items-center gap-3 text-xs text-muted-foreground">
      <span>{label}</span>
      <Progress value={value} />
    </label>
  );
}
