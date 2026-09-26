import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderChronicle } from "../world/sim.js";
import { salientEvents } from "../world/salience.js";
import type { World } from "../world/types.js";
import { clockLabel } from "../world/types.js";
import { dataDir } from "./env.js";

export function writeChronicle(world: World): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(resolve(dataDir, "events.md"), renderChronicle(world), "utf8");
  writeFileSync(
    resolve(dataDir, "inner.json"),
    JSON.stringify(
      {
        chronicle: world.chronicle,
        chronicleAt: world.chronicleAt,
        people: world.people.map((person) => ({ id: person.id, mood: person.mood, innerNote: person.innerNote })),
        bonds: world.bonds,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function loadInner(world: World): void {
  const path = resolve(dataDir, "inner.json");
  if (!existsSync(path)) return;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      chronicle?: unknown;
      chronicleAt?: unknown;
      people?: { id?: string; mood?: string; innerNote?: string }[];
      bonds?: { a?: string; b?: string; score?: number; note?: string }[];
    };
    if (typeof raw.chronicle === "string") world.chronicle = raw.chronicle;
    if (typeof raw.chronicleAt === "string") world.chronicleAt = raw.chronicleAt;
    for (const item of raw.people ?? []) {
      const person = world.people.find((candidate) => candidate.id === item.id);
      if (!person) continue;
      if (item.mood) person.mood = item.mood;
      if (item.innerNote) person.innerNote = item.innerNote;
    }
    for (const item of raw.bonds ?? []) {
      const bond = world.bonds.find(
        (candidate) =>
          (candidate.a === item.a && candidate.b === item.b) || (candidate.a === item.b && candidate.b === item.a),
      );
      if (!bond) continue;
      if (typeof item.score === "number") bond.score = item.score;
      if (item.note) bond.note = item.note;
    }
  } catch {
    world.luna.lastError = "Could not read data/inner.json, so the town started from the seed.";
  }
}

interface StoryPerson {
  id?: unknown;
  mood?: unknown;
  note?: unknown;
}

interface StoryBond {
  a?: unknown;
  b?: unknown;
  note?: unknown;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function compactStory(world: World): Promise<void> {
  const key = process.env.OPENAI_API_KEY;
  world.luna.model = process.env.STORY_MODEL || "gpt-6-luna";
  if (!key) {
    world.luna.configured = false;
    world.luna.status = "off";
    world.luna.lastError = "OPENAI_API_KEY is not set";
    return;
  }
  world.luna.configured = true;
  world.luna.status = "working";
  try {
    const text = await generate(key, world.luna.model, promptFor(world));
    applyUpdate(world, text);
    world.luna.status = "ready";
    world.luna.lastError = null;
    world.luna.calls += 1;
    world.uncompiled = 0;
    world.chronicleAt = `${clockLabel(world.hour, world.minute)} village time`;
    writeChronicle(world);
  } catch (error) {
    world.luna.status = "error";
    world.luna.lastError = error instanceof Error ? error.message : "Storyteller failed";
  }
}

function promptFor(world: World): string {
  const people = world.people.map((person) => ({
    id: person.id,
    name: person.name,
    passion: person.self.ambition.passion,
    love: person.self.ambition.love,
    plan: person.self.ambition.plan,
    likes: person.self.ambition.likes,
    dislikes: person.self.ambition.dislikes,
    project: person.self.ambition.project,
    mood: person.mood,
    place: person.place,
  }));
  // Salience picks the day's material moments, not just the last dozen lines.
  const recent = salientEvents(world, world.tick - 1440, 12).map(
    (event) => `${event.clock} ${event.audience === "private" ? "(private) " : ""}${event.text}`,
  );
  const built = world.expansions.map((item) => item.label);
  return [
    `This is the close of day ${world.summaryFor ?? world.day}. Write only what already happened.`,
    "Past tense. Key points: work, weather, love, jealousy, rivalry, births, deaths, and anything someone built.",
    "built is the full list of finished works. Name only those, and do not raise the count. If built is empty, do not say a shrine, garden, stall, orchard, house, or watch was made.",
    "Do not greet the morning. Do not say the day is young, that people are just waking, or that nothing has happened.",
    "If the log is thin, name the few things that did occur. Do not invent a fresh start.",
    "Visitors are outsiders who walked in. If one is listed, their talk and suggestions are part of the day. Do not invent visitors who are not listed.",
    "matters are one-to-one aims already underway. Mention one only when it is listed. Do not invent a courtship, a feud, or a lesson.",
    "Return JSON with chronicle, story, people, bonds.",
    "story.headline is one line about the day that ended. story.body is two sentences of that finished day. story.gossip is exactly 3 short lines a neighbor would repeat the next morning.",
    "Do not quote private speech in story.body or story.gossip. You may hint that two people spoke aside.",
    "chronicle is the same public memory in one paragraph.",
    "people: for each id, mood and note, one short sentence each, consistent with their passion, love, likes, and plan.",
    "bonds: only pairs that changed, with a one-sentence note.",
    JSON.stringify({
      closedDay: world.summaryFor ?? world.day,
      hour: clockLabel(world.hour, world.minute),
      weather: world.weather,
      phase: world.phase,
      built,
      people,
      recent,
      visitors: world.visitors.map((visitor) => ({ name: visitor.name, place: visitor.place, note: visitor.note })),
      matters: world.people
        .filter((person) => person.matter)
        .map((person) => ({
          name: person.name,
          with: world.people.find((other) => other.id === person.matter?.withId)?.name ?? "",
          kind: person.matter?.kind,
          step: person.matter?.step,
        })),
    }),
  ].join("\n");
}

function applyUpdate(world: World, raw: string): void {
  const parsed = JSON.parse(stripFence(raw)) as {
    chronicle?: unknown;
    people?: unknown;
    bonds?: unknown;
    story?: { headline?: unknown; body?: unknown; gossip?: unknown };
  };
  const chronicle = asText(parsed.chronicle);
  if (chronicle) world.chronicle = chronicle;
  const story = parsed.story;
  if (story && typeof story === "object") {
    const headline = asText(story.headline);
    const body = asText(story.body);
    const gossip = Array.isArray(story.gossip) ? story.gossip.map(asText).filter(Boolean).slice(0, 3) : [];
    if (headline) world.story.headline = headline.slice(0, 120);
    if (body) world.story.body = body.slice(0, 500);
    if (gossip.length) world.story.gossip = gossip;
    world.story.day = world.summaryFor ?? world.day;
    world.story.at = world.summaryFor ? "end of day" : "so far";
  }
  if (Array.isArray(parsed.people)) {
    for (const item of parsed.people as StoryPerson[]) {
      const id = asText(item.id);
      const person = world.people.find((candidate) => candidate.id === id);
      if (!person) continue;
      const mood = asText(item.mood);
      const note = asText(item.note);
      if (mood) person.mood = mood.slice(0, 180);
      if (note) person.innerNote = note.slice(0, 220);
    }
  }
  if (Array.isArray(parsed.bonds)) {
    for (const item of parsed.bonds as StoryBond[]) {
      const a = asText(item.a);
      const b = asText(item.b);
      const note = asText(item.note);
      if (!note) continue;
      const bond = world.bonds.find(
        (candidate) =>
          (candidate.a === a && candidate.b === b) || (candidate.a === b && candidate.b === a),
      );
      if (bond) bond.note = note.slice(0, 220);
    }
  }
}

function stripFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

async function generate(key: string, model: string, prompt: string): Promise<string> {
  const withLowReasoning = await request(key, model, prompt, { reasoning_effort: "low" });
  if (withLowReasoning.ok) return withLowReasoning.text;
  if (withLowReasoning.status !== 400) throw new Error(withLowReasoning.error);
  const plain = await request(key, model, prompt, {});
  if (!plain.ok) throw new Error(plain.error);
  return plain.text;
}

async function request(
  key: string,
  model: string,
  prompt: string,
  extra: Record<string, unknown>,
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You narrate JEV City for visitors. You write gossip and the public story. You never choose a resident's next act. JSON only.",
        },
        { role: "user", content: prompt },
      ],
      ...extra,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    return { ok: false, status: response.status, error: `Luna ${response.status}: ${detail}` };
  }
  const body = (await response.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | { text?: string }[] | null } }[];
  };
  const choice = body.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part.text ?? "").join("")
      : "";
  if (!text.trim()) {
    return { ok: false, status: 502, error: `Luna returned an empty story (${choice?.finish_reason ?? "no choice"})` };
  }
  return { ok: true, text };
}
