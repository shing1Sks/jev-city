import { useEffect, useRef, useState, type FormEvent } from "react";
import { PLACES, placeOf } from "../world/map.js";
import type { PublicPerson, PublicState, VisitorMark } from "../world/types.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";

const SESSION = "jev-city-visitor";

export interface VisitSession {
  id: string;
  name: string;
}

export function readSession(): VisitSession | null {
  try {
    const raw = localStorage.getItem(SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VisitSession>;
    if (!parsed.id || !parsed.name) return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

function saveSession(session: VisitSession | null): void {
  if (!session) localStorage.removeItem(SESSION);
  else localStorage.setItem(SESSION, JSON.stringify(session));
}

export function VisitorSprite({
  visitor,
  at,
  moving,
  onPick,
}: {
  visitor: VisitorMark;
  at: { x: number; y: number } | undefined;
  moving: boolean;
  onPick: (id: string) => void;
}) {
  const x = at?.x ?? (Number.isFinite(visitor.x) ? visitor.x : 52);
  const y = at?.y ?? (Number.isFinite(visitor.y) ? visitor.y : 56);
  const facing = visitor.facing || "front";
  const dir = facing.charAt(0).toUpperCase() + facing.slice(1);
  const suggesting = visitor.speech?.text.startsWith("suggests:");
  const said = suggesting ? visitor.speech?.text.slice("suggests:".length).trim() : visitor.speech?.text;

  return (
    <button
      type="button"
      className={`actor visitor ${moving ? "moving" : ""} ${visitor.speech ? "speaking" : ""}`}
      style={{ left: `${x}%`, top: `${y}%`, width: "3.6%" }}
      data-visitor={visitor.id}
      aria-label={visitor.speech ? `${visitor.name}, ${suggesting ? "suggests" : "says"}, ${said}` : visitor.name}
      onClick={(event) => {
        event.stopPropagation();
        onPick(visitor.id);
      }}
    >
      {visitor.speech ? (
        <span className="subtitle">
          <span className="how">{suggesting ? "suggests" : "says"}</span>
          <span className="what">{said}</span>
        </span>
      ) : null}
      <i
        className={`goblin ${moving ? "walk" : "idle"}`}
        style={{
          backgroundImage: `url("/craft/goblin/male-${dir}---${moving ? "Walking" : "Idle"}.png")`,
          filter: "hue-rotate(200deg) saturate(0.7)",
        }}
      />
      <b>{visitor.name}</b>
      <span className="caption">
        <strong>{visitor.name}</strong>
        <span>visitor</span>
        <span className="how">{visitor.note || "looking around"}</span>
      </span>
    </button>
  );
}

export function VisitDock({
  state,
  session,
  setSession,
  addressIds,
  setAddressIds,
}: {
  state: PublicState | null;
  session: VisitSession | null;
  setSession: (session: VisitSession | null) => void;
  addressIds: string[];
  setAddressIds: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [suggest, setSuggest] = useState(false);
  const [mode, setMode] = useState<"all" | "one" | "few">("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const missingSince = useRef<number | null>(null);
  const people = (state?.people ?? []).filter((person) => person.alive !== false);
  const mine = session ? state?.visitors?.find((visitor) => visitor.id === session.id) : undefined;

  useEffect(() => {
    if (!state || !session) return;
    if (state.visitors?.some((visitor) => visitor.id === session.id)) {
      missingSince.current = null;
      return;
    }
    if (missingSince.current === null) missingSince.current = Date.now();
    if (Date.now() - missingSince.current > 4000) {
      saveSession(null);
      setSession(null);
      setError("The town no longer has that visitor.");
    }
  }, [state, session, setSession]);

  useEffect(() => {
    if (addressIds.length === 1) setMode("one");
    else if (addressIds.length > 1) setMode("few");
  }, [addressIds]);

  async function enter(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await post("/api/visit/enter", { name });
      if (result.error || !result.id || !result.name) {
        setError(result.error || "The town did not let you in.");
        return;
      }
      const next = { id: result.id, name: result.name };
      saveSession(next);
      setSession(next);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  async function say(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const line = compose(mode, text, addressIds, people);
    if (!line) {
      setError("Choose who hears you, then write a line.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await post("/api/visit/say", { id: session.id, text: line, suggest });
      if (result.error) setError(result.error);
      else setText("");
    } finally {
      setBusy(false);
    }
  }

  async function go(place: string) {
    if (!session) return;
    setError("");
    const result = await post("/api/visit/go", { id: session.id, place });
    if (result.error) setError(result.error);
  }

  async function leave() {
    if (!session) return;
    await post("/api/visit/leave", { id: session.id });
    saveSession(null);
    setSession(null);
    setAddressIds([]);
  }

  const log = (state?.visitorLog ?? []).slice(-8).reverse();
  const preview = session ? compose(mode, text || "…", addressIds, people) : "";

  return (
    <Card className={`absolute right-3 bottom-3 z-20 border-primary/30 bg-card/95 ${open ? "w-[min(24rem,calc(100%-1.5rem))] max-h-[52vh] overflow-auto" : "w-auto border-0 bg-transparent shadow-none"}`} onClick={(event) => event.stopPropagation()}>
      <CardHeader className="p-3 pb-0">
        <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : session ? session.name : "Enter"}
        </Button>
      </CardHeader>
      {open ? (
        session ? (
          <>
            <CardContent className="space-y-3 px-4 pt-2 pb-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{session.name}</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => void leave()}>Leave</Button>
            </div>
            <p className="text-sm text-muted-foreground">You are a visitor. Walk, talk, and suggest. The town hears you come in.</p>
            {mine ? <p className="text-sm text-muted-foreground">At {placeOf(mine.place).name}. {mine.note}</p> : null}
            <div className="max-h-28 space-y-1 overflow-auto text-sm" aria-live="polite">
              {log.length === 0 ? <p className="text-muted-foreground">No one from outside has spoken yet.</p> : null}
              {log.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant={mode === "all" ? "default" : "outline"} onClick={() => { setMode("all"); setAddressIds([]); }}>@all</Button>
              <Button type="button" size="sm" variant={mode === "one" ? "default" : "outline"} onClick={() => setMode("one")}>@name</Button>
              <Button type="button" size="sm" variant={mode === "few" ? "default" : "outline"} onClick={() => setMode("few")}>@@</Button>
              <Button type="button" size="sm" variant={suggest ? "default" : "outline"} onClick={() => setSuggest((value) => !value)}>Suggest</Button>
            </div>
            {mode === "one" ? (
              <label className="grid gap-1 text-sm text-muted-foreground">
                One person
                <select className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground" value={addressIds[0] ?? ""} onChange={(event) => setAddressIds(event.target.value ? [event.target.value] : [])}>
                  <option value="">Choose</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
            ) : null}
            {mode === "few" ? (
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-auto">
                {people.map((person) => {
                  const on = addressIds.includes(person.id);
                  return (
                    <Button
                      key={person.id}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      onClick={() => {
                        if (on) setAddressIds(addressIds.filter((id) => id !== person.id));
                        else if (addressIds.length < 3) setAddressIds([...addressIds, person.id]);
                      }}
                    >
                      {person.name}
                    </Button>
                  );
                })}
              </div>
            ) : null}
            <form className="space-y-2" onSubmit={(event) => void say(event)}>
              <Textarea
                value={text}
                maxLength={180}
                placeholder={suggest ? "A suggestion they might take up" : "What you say"}
                onChange={(event) => setText(event.target.value)}
              />
              {preview ? <p className="text-xs text-muted-foreground">{suggest ? `suggest ${preview}` : preview}</p> : null}
              <Button type="submit" disabled={busy}>Send</Button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {PLACES.map((place) => (
                <Button key={place.id} type="button" size="sm" variant="outline" onClick={() => void go(place.id)}>{place.name}</Button>
              ))}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </CardContent>
          </>
        ) : (
          <form className="space-y-3 px-4 pt-2 pb-4" onSubmit={(event) => void enter(event)}>
            <CardTitle>Enter as a visitor</CardTitle>
            <p className="text-sm text-muted-foreground">Take a name, walk the town, and talk. Ten visitors from one address.</p>
            <Input
              value={name}
              maxLength={18}
              placeholder="Your name"
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={busy}>Enter the town</Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
        )
      ) : null}
    </Card>
  );
}

function compose(mode: "all" | "one" | "few", text: string, ids: string[], people: PublicPerson[]): string {
  const body = text.trim();
  if (!body) return "";
  if (mode === "all") return `@all ${body}`;
  const named = ids
    .map((id) => people.find((person) => person.id === id)?.name)
    .filter((item): item is string => Boolean(item));
  if (mode === "one") return named[0] ? `@${named[0]} ${body}` : "";
  const few = named.slice(0, 3);
  return few.length > 0 ? `@@ ${few.join(" ")} ${body}` : "";
}

async function post(path: string, body: unknown): Promise<{ error?: string; id?: string; name?: string }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; id?: string; name?: string };
  if (!response.ok && !data.error) return { error: "The town did not answer." };
  return data;
}
