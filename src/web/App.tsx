import { useEffect, useRef, useState, type ReactElement } from "react";
import { carryCount, carryLabel } from "../world/carry.js";
import { householdName } from "../world/cast.js";
import { VISITORS_OPEN } from "../world/gates.js";
import { INTENTS, TOPICS, TONES } from "../world/lexicon.js";
import { placeOf } from "../world/map.js";
import { lawLines } from "../world/rules.js";
import type { Animal, BuildSite, Expansion, PlaceId, PublicPerson, PublicState } from "../world/types.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card.js";
import { Progress } from "./components/ui/progress.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Separator } from "./components/ui/separator.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./components/ui/sheet.js";
import { FEEL, LOOKS, PROPS, ROUTES, SPOTS, WORKS, bodyScale, nodeLook } from "./village.js";
import { VisitDock, VisitorSprite, readSession, type VisitSession } from "./visit.js";

export function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
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
        <span className="text-xs text-muted-foreground" title={state?.soul.lastError ?? undefined}>
          spine: {state?.soul.mode === "jev" && state?.soul.configured ? `jev${state.soul.lastModel ? ` · ${state.soul.lastModel}` : ""}` : "reflex"}
          {state && state.soul.inputTokens > 0 ? ` · ${(state.soul.inputTokens / 1000).toFixed(1)}k tok` : ""}
          {state && (state.soul.costUsd ?? 0) >= 0.005 ? ` · $${(state.soul.costUsd ?? 0).toFixed(3)}` : ""}
        </span>
        {state?.brain.configured ? (
          <span className="text-xs text-muted-foreground" title={state.brain.lastError ?? undefined}>
            luna: {state.brain.status === "working" ? "thinking…" : state.brain.status === "error" ? "error" : `luna${state.brain.lastModel ? ` · ${state.brain.lastModel}` : ""}`}
            {state.brain.calls > 0 ? ` · ${state.brain.calls} calls` : ""}
            {state.brain.inputTokens > 0 ? ` · ${(state.brain.inputTokens / 1000).toFixed(1)}k tok` : ""}
            {(state.brain.costUsd ?? 0) >= 0.005 ? ` · $${(state.brain.costUsd ?? 0).toFixed(3)}` : ""}
          </span>
        ) : null}
        {offline ? <Badge variant="destructive">Reconnecting</Badge> : null}
        <a
          className="ml-auto shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          href="https://github.com/shing1Sks/jev-city"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </header>

      <aside className="z-20 shrink-0 border-b bg-amber-500/10 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-serif font-medium text-foreground">The town is paused.</strong>{" "}
        Everything you see is programmed behavior — physics, law, instincts, trade. The
        intelligence (Jev and Luna, the AI minds) has been disconnected for now. The full
        story is in the repository.
      </aside>

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
          {state?.nodes.map((node) => {
            const look = nodeLook(node);
            if (look) {
              return (
                <img
                  key={node.id}
                  className="node"
                  src={look.src}
                  alt=""
                  draggable={false}
                  style={{ left: `${node.x}%`, top: `${node.y}%`, width: `${look.w}%` }}
                />
              );
            }
            return (
              <span
                key={node.id}
                className={`crop s${node.stage}${node.stage >= node.maxStage ? " ripe" : ""}`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                title={node.stage >= node.maxStage ? "ripe grain" : `grain, growing (${node.stage}/${node.maxStage})`}
              />
            );
          })}
          {state?.sites.map((site) => (
            <SiteMark key={site.id} site={site} />
          ))}
          <div className="veil" />
          {weather === "rain" ? <div className="rain" /> : null}
          {weather === "storm" ? <div className="rain storm" /> : null}
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
          {(state?.animals ?? []).map((animal) => (
            <AnimalSprite key={animal.id} animal={animal} />
          ))}
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
          {VISITORS_OPEN
            ? (state?.visitors ?? []).map((visitor) => (
              <VisitorSprite
                key={visitor.id}
                visitor={visitor}
                at={laid[visitor.id]}
                moving={Math.hypot(visitor.x - (fromPos.current[visitor.id]?.x ?? visitor.x), visitor.y - (fromPos.current[visitor.id]?.y ?? visitor.y)) > 0.4}
                onPick={() => undefined}
              />
            ))
            : null}
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

        <TownLog state={state} open={logOpen} setOpen={setLogOpen} />
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
  const laid: Record<string, { x: number; y: number }> = {};
  for (const person of state.people.filter((item) => item.alive !== false)) {
    const here = pointOf(person);
    const origin = from[person.id] && Number.isFinite(from[person.id]?.x) ? from[person.id] : here;
    laid[person.id] = {
      x: (origin?.x ?? here.x) + (here.x - (origin?.x ?? here.x)) * glide,
      y: (origin?.y ?? here.y) + (here.y - (origin?.y ?? here.y)) * glide,
    };
  }
  for (const visitor of state.visitors ?? []) {
    const here = { x: Number.isFinite(visitor.x) ? visitor.x : 52, y: Number.isFinite(visitor.y) ? visitor.y : 56 };
    const origin = from[visitor.id] && Number.isFinite(from[visitor.id]?.x) ? from[visitor.id] : here;
    laid[visitor.id] = {
      x: (origin?.x ?? here.x) + (here.x - (origin?.x ?? here.x)) * glide,
      y: (origin?.y ?? here.y) + (here.y - (origin?.y ?? here.y)) * glide,
    };
  }
  return laid;
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

// ------------------------------------------------------------- wild animals

/** Stage footprint as a percent of scene width; an adult person marker is 4.1%. */
const ANIMAL_WIDTH: Record<Animal["kind"], number> = { crow: 2.7, deer: 4.8, dog: 4.1 };

/** Simple right-facing glyphs drawn in the same flat, outlined language as the stage props. */
const ANIMAL_ART: Record<Animal["kind"], ReactElement> = {
  crow: (
    <>
      <polygon points="8,17 1,13 6,21" fill="#26262d" stroke="#15151a" strokeWidth="0.8" strokeLinejoin="round" />
      <ellipse cx="14.5" cy="18" rx="8" ry="5.6" fill="#2f2f38" stroke="#15151a" strokeWidth="1.1" />
      <ellipse cx="13" cy="16.4" rx="4.6" ry="2.5" fill="#3c3c47" transform="rotate(-14 13 16.4)" />
      <circle cx="23" cy="12.6" r="4" fill="#2f2f38" stroke="#15151a" strokeWidth="1.1" />
      <polygon points="26.6,11.4 30.6,13.2 26.6,14.6" fill="#d8a04c" />
      <circle cx="24.2" cy="11.7" r="0.75" fill="#0c0c10" />
      <path d="M12 23.4 L12 27.6 M17 23.4 L17 27.6" stroke="#15151a" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </>
  ),
  deer: (
    <>
      <path d="M9 22.5 L8 28 M19 22.5 L20 28" stroke="#8a6238" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M23.4 6.4 L22.6 2.6 M23.4 6.4 L26.4 3.4 M22.2 6.2 L20.6 3.2" stroke="#8a6238" strokeWidth="1" strokeLinecap="round" fill="none" />
      <circle cx="5.8" cy="16.8" r="1.4" fill="#e6cba0" stroke="#8a6238" strokeWidth="0.7" />
      <ellipse cx="14" cy="19" rx="9" ry="5.4" fill="#c99a63" stroke="#8a6238" strokeWidth="1.1" />
      <path d="M19.5 16.5 L23 8.5 L26.5 10 L22.5 18.5 Z" fill="#c99a63" stroke="#8a6238" strokeWidth="1" strokeLinejoin="round" />
      <path d="M23.6 6.6 L21.6 4.4" stroke="#8a6238" strokeWidth="1" strokeLinecap="round" fill="none" />
      <ellipse cx="25.4" cy="8.8" rx="3" ry="2.3" fill="#c99a63" stroke="#8a6238" strokeWidth="1.1" />
      <circle cx="26.6" cy="8.2" r="0.7" fill="#3b2a18" />
      <path d="M11 22.5 L11 28 M17 22.5 L17.5 28" stroke="#a87c4b" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </>
  ),
  dog: (
    <>
      <path d="M9 21.5 L8 28 M13.5 22 L13.5 28" stroke="#5d442b" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M6.5 15.5 C3.8 13.8 3.4 10.8 5.2 9.4" fill="none" stroke="#8a6642" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="14.5" cy="18.5" rx="8.5" ry="5.2" fill="#8a6642" stroke="#5d442b" strokeWidth="1.1" />
      <polygon points="21.4,11.2 20.2,6.8 24,9.4" fill="#6f5233" stroke="#5d442b" strokeWidth="0.8" strokeLinejoin="round" />
      <circle cx="23.5" cy="14.5" r="3.9" fill="#8a6642" stroke="#5d442b" strokeWidth="1.1" />
      <ellipse cx="28.2" cy="15.8" rx="2" ry="1.4" fill="#9c7850" stroke="#5d442b" strokeWidth="0.8" />
      <circle cx="29.8" cy="15.4" r="0.8" fill="#2b2016" />
      <circle cx="24.4" cy="13.4" r="0.75" fill="#2b2016" />
      <path d="M18 21.5 L18.5 28 M22 20.5 L23 27.6" stroke="#8a6642" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </>
  ),
};

function AnimalSprite({ animal }: { animal: Animal }) {
  const x = Number.isFinite(animal.x) ? animal.x : 50;
  const y = Number.isFinite(animal.y) ? animal.y : 50;
  const flip = animal.facing === "left";
  const fleeing = animal.step?.kind === "flee";
  return (
    <span
      title={`${animal.kind} — ${Math.round(animal.hunger)}/100 hungry`}
      style={{
        position: "absolute",
        zIndex: 2,
        left: `${x}%`,
        top: `${y}%`,
        width: `${ANIMAL_WIDTH[animal.kind]}%`,
        transform: "translate(-50%, -78%)",
        filter: "drop-shadow(0 2px 0 rgba(0, 0, 0, 0.22))",
      }}
    >
      <svg
        viewBox="0 0 32 32"
        style={{ display: "block", width: "100%", height: "auto", transform: flip ? "scaleX(-1)" : undefined }}
        aria-hidden="true"
      >
        {ANIMAL_ART[animal.kind]}
      </svg>
      {fleeing ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "-16%",
            right: "-8%",
            color: "#e07a6a",
            fontSize: "0.62rem",
            fontWeight: 700,
            lineHeight: 1,
            textShadow: "0 1px 0 rgba(0, 0, 0, 0.35)",
          }}
        >
          !
        </span>
      ) : null}
      <span className="sr-only">{`${animal.kind} — ${Math.round(animal.hunger)}/100 hungry`}</span>
    </span>
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
          {person.task ? <p className="text-sm text-muted-foreground">on task: <span className="text-foreground">{person.task.label}</span></p> : null}
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
          {person.beliefs && person.beliefs.length > 0 ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="text-foreground">Keeps in mind</p>
              {person.beliefs.slice(-3).map((belief) => (
                <p key={`${belief.about}-${belief.polarity}`}>{belief.text}</p>
              ))}
            </div>
          ) : null}
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
            Household store — wood {state.storages[person.household]?.wood ?? 0} · stone {state.storages[person.household]?.stone ?? 0} · grain{" "}
            {state.storages[person.household]?.grain ?? 0} · berries {state.storages[person.household]?.berries ?? 0} · cloth{" "}
            {state.storages[person.household]?.cloth ?? 0}
          </p>
          <p className="text-xs text-muted-foreground">
            Authority {person.authority ?? 0}
            {carryCount(person.carry) > 0 ? ` · carrying ${carryLabel(person.carry)}` : " · hands free"}
          </p>
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
          {state.luna.lastError ? <p className="text-xs text-destructive">{state.luna.lastError}</p> : null}
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

function SiteMark({ site }: { site: BuildSite }) {
  const items = Object.keys(site.need) as (keyof typeof site.need)[];
  const total = items.reduce((sum, item) => sum + (site.need[item] ?? 0), 0);
  const have = items.reduce((sum, item) => sum + Math.min(site.have[item] ?? 0, site.need[item] ?? 0), 0);
  const percent = total > 0 ? Math.round((have / total) * 100) : 100;
  const materials = items
    .filter((item) => (site.need[item] ?? 0) > 0)
    .map((item) => `${Math.min(site.have[item] ?? 0, site.need[item] ?? 0)}/${site.need[item]} ${item}`)
    .join(" · ");
  return (
    <span className="site" style={{ left: `${site.x}%`, top: `${site.y}%` }} title={`${site.label} — ${materials}`}>
      <i className="scaffold" />
      <b>{site.label}</b>
      <span className="bar">
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="mat">{materials}</span>
    </span>
  );
}

const LOG_KINDS: Record<string, string> = {
  life: "life",
  build: "build",
  law: "law",
  weather: "weather",
  meal: "meal",
  speech: "speech",
  work: "work",
  move: "move",
};

const LOG_KIND_ORDER: string[] = ["speech", "work", "life", "build", "law", "weather", "meal", "move"];

function TownLog({ state, open, setOpen }: { state: PublicState | null; open: boolean; setOpen: (open: boolean) => void }) {
  const [kind, setKind] = useState("all");
  const [personId, setPersonId] = useState("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const dayStart = state ? state.tick - (state.tick % 1440) : 0;
  const events = [...(state?.log ?? [])]
    .reverse()
    .filter(
      (event) =>
        (kind === "all" || event.kind === kind) &&
        (personId === "all" || event.speakerId === personId || event.listenerId === personId || event.heardBy.includes(personId)) &&
        (!todayOnly || event.tick >= dayStart),
    )
    .slice(0, 80);
  return (
    <Card
      className={`absolute z-20 top-3 right-3 overflow-hidden border-primary/30 bg-card/95 shadow-lg ${
        open ? "flex w-[min(21rem,calc(100%-1.5rem))] max-h-[min(24rem,55vh)] flex-col" : "w-auto border-0 bg-transparent shadow-none"
      }`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`flex w-full shrink-0 items-center justify-between gap-3 px-3 py-2 text-left text-[0.68rem] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground ${
          open ? "border-b bg-card/60" : ""
        }`}
        onClick={() => setOpen(!open)}
      >
        <span>Town log{state ? ` · day ${state.day}` : ""}</span>
        <span aria-hidden className="text-[0.7rem] leading-none">
          {open ? "▾" : "▴"}
        </span>
      </button>
      {open ? (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-card/60 px-3 py-1.5">
            {["all", ...LOG_KIND_ORDER].map((option) => (
              <LogChip key={option} active={kind === option} onClick={() => setKind(option)}>
                {option}
              </LogChip>
            ))}
            <LogChip active={todayOnly} onClick={() => setTodayOnly(!todayOnly)}>
              today
            </LogChip>
            <select
              className="bg-card/60 border border-border rounded px-1.5 py-0.5 text-xs"
              value={personId}
              onChange={(event) => setPersonId(event.target.value)}
            >
              <option value="all">everyone</option>
              {(state?.people ?? [])
                .filter((person) => person.alive !== false)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
            <span className="ml-auto text-[0.65rem] text-muted-foreground">{events.length} lines</span>
          </div>
          <ul className="logscroll min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
            {events.length === 0 ? <li className="text-sm text-muted-foreground">Nothing matches these filters.</li> : null}
            {events.map((event) => (
              <li key={event.id} className={`logline ${LOG_KINDS[event.kind] ?? "work"}`}>
                <i className="k" />
                <time>{event.clock}</time>
                <span>{event.text}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

function LogChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={`rounded-full border px-1.5 py-0.5 text-[0.65rem] leading-none transition-colors ${
        active ? "border-primary/40 bg-primary/20 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
