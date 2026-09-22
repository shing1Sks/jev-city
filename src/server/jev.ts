import { choice, noul, TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import { allowedIntentIds, allowedTopicIds, allowedToneIds, TONES, TOPICS } from "../world/lexicon.js";
import { placeOf } from "../world/map.js";
import { reflexDecide } from "../world/reflex.js";
import { customBonus, legalActions } from "../world/rules.js";
import { legalAudiences, othersHere } from "../world/speech.js";
import { applyDecision } from "../world/sim.js";
import type { Decision, Person, World } from "../world/types.js";
import { bondKey, clockLabel } from "../world/types.js";

let client: TypeSafeClient | null = null;

function jevClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient({
      timeout: 12_000,
      logLevel: "warn",
      defaultModel: process.env.JEV_MODEL || "jev-latest",
    });
  }
  return client;
}

export async function decideWithJev(world: World, ids: string[]): Promise<void> {
  const pending: string[] = [];
  for (const id of ids) {
    const person = world.people.find((item) => item.id === id);
    if (!person || person.intent) continue;
    const actions = legalActions(person, world);
    if (actions.length <= 1) {
      applyDecision(world, reflexDecide(world, id));
      continue;
    }
    pending.push(id);
  }
  if (pending.length === 0 || !process.env.TYPESAFE_API_KEY) {
    if (!process.env.TYPESAFE_API_KEY) {
      for (const id of pending) applyDecision(world, reflexDecide(world, id));
    }
    return;
  }

  const questions: Questions = {};
  const meta = new Map<string, { audiences: ReturnType<typeof legalAudiences>; others: Person[] }>();
  for (const id of pending) {
    const person = world.people.find((item) => item.id === id);
    if (!person) continue;
    const actions = legalActions(person, world);
    const audiences = legalAudiences(person, world);
    const others = othersHere(person, world);
    meta.set(id, { audiences, others });
    const criteria = Object.fromEntries(actions.map((action) => [action.id, `${action.label}. ${action.detail}`]));
    questions[`${id}__act`] = choice(
      {
        question: `Which legal act should ${person.name} do next?`,
        temper: person.self.temper,
        want: person.self.want,
        fear: person.self.fear,
        habit: person.self.habit,
        passion: person.self.ambition.passion,
        mood: person.mood,
      },
      criteria,
    );
    questions[`${id}__say`] = noul({
      question: `Should ${person.name} speak out loud on this act?`,
      yes: "A need, a greeting, a warning, or something only one person should hear.",
      no: "Silence fits this moment.",
    });
    if (audiences.length > 1) {
      questions[`${id}__who`] = choice(`Who is ${person.name}'s speech for?`, {
        ...(audiences.includes("private") ? { private: "One person standing here. The rest do not hear it." } : {}),
        ...(audiences.includes("here") ? { here: "Everyone in this place." } : {}),
        ...(audiences.includes("town") ? { town: "An announcement to all of JEV City, from the square." } : {}),
      });
    }
    if (audiences.includes("private") && others.length > 1) {
      questions[`${id}__to`] = choice(
        `If ${person.name} speaks in private, who is it for?`,
        Object.fromEntries(others.map((other) => [other.id, `${other.name}, ${other.band}, ${other.self.temper}`])),
      );
    }
    const intents = allowedIntentIds(person.band);
    const topics = allowedTopicIds(person.band);
    const tones = allowedToneIds(person.band);
    questions[`${id}__word`] = choice(
      `Which lexicon word carries ${person.name}'s meaning?`,
      Object.fromEntries(intents.map((intent) => [intent, intent])),
    );
    questions[`${id}__topic`] = choice(
      `What is ${person.name} speaking about?`,
      Object.fromEntries(topics.map((topic) => [topic, TOPICS.find((item) => item.id === topic)?.label ?? topic])),
    );
    questions[`${id}__tone`] = choice(
      `Which tone should color ${person.name}'s line?`,
      Object.fromEntries(tones.map((tone) => [tone, TONES.find((item) => item.id === tone)?.label ?? tone])),
    );
  }

  const state = {
    town: "JEV City. Law has already removed illegal acts. Choose within the list. Custom is a preference, not a ban. If a person has a matter, spend the free turns reaching that one person and speaking with them in private. Do not chase food unless hunger is severe.",
    clock: clockLabel(world.hour, world.minute),
    phase: world.phase,
    weather: world.weather,
    people: world.people.map((person) => ({
      id: person.id,
      name: person.name,
      place: placeOf(person.place).name,
      band: person.band,
      mood: person.mood,
    })),
    deciders: pending.flatMap((id) => {
      const person = world.people.find((item) => item.id === id);
      if (!person) return [];
      return [{
        id: person.id,
        name: person.name,
        age: person.age,
        gender: person.gender,
        band: person.band,
        custom: person.self.custom,
        customBias: customBonus(person, "farm"),
        place: person.place,
        home: person.home,
        hunger: Math.round(person.hunger),
        energy: Math.round(person.energy),
        belonging: Math.round(person.belonging),
        foodAtHome: world.food[person.household] ?? 0,
        mood: person.mood,
        note: person.innerNote,
        temper: person.self.temper,
        want: person.self.want,
        fear: person.self.fear,
        habit: person.self.habit,
        passion: person.self.ambition.passion,
        plan: person.self.ambition.plan,
        likes: person.self.ambition.likes,
        matter: person.matter
          ? {
              with: world.people.find((other) => other.id === person.matter?.withId)?.name ?? person.matter.withId,
              kind: person.matter.kind,
              step: person.matter.step,
            }
          : null,
        nearby: othersHere(person, world).map((other) => other.name),
        bonds: world.bonds
          .filter((bond) => bond.a === person.id || bond.b === person.id)
          .slice(0, 4)
          .map((bond) => {
            const otherId = bond.a === person.id ? bond.b : bond.a;
            const other = world.people.find((item) => item.id === otherId);
            return { with: other?.name ?? otherId, score: bond.score, note: bond.note, key: bondKey(bond.a, bond.b) };
          }),
        recent: person.memory.slice(-3).map((line) => line.text),
      }];
    }),
  };

  const model = process.env.JEV_MODEL || "jev-latest";
  let result;
  try {
    result = await jevClient().systemOne({ state, questions, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (model !== "jev-preview" && /model|not found|404/i.test(message)) {
      result = await jevClient().systemOne({ state, questions, model: "jev-preview" });
    } else {
      throw error;
    }
  }

  world.soul.lastModel = result.model;
  world.soul.calls += 1;
  world.soul.inputTokens += result.usage.input_tokens;
  world.soul.outputTokens += result.usage.output_tokens;
  world.soul.lastError = null;

  const answers = result.answers as Record<string, { type: string; choice?: string; confidence?: number; noul?: number }>;
  for (const id of pending) {
    const person = world.people.find((item) => item.id === id);
    const info = meta.get(id);
    if (!person || !info) continue;
    const act = answers[`${id}__act`];
    if (!act || act.type !== "choice" || !act.choice || (act.confidence ?? 1) < 0.4) {
      const fallback = reflexDecide(world, id);
      fallback.because = "JEV was unsure, so reflex chose";
      applyDecision(world, fallback);
      continue;
    }
    const say = answers[`${id}__say`];
    const who = answers[`${id}__who`];
    const to = answers[`${id}__to`];
    const word = answers[`${id}__word`];
    const topic = answers[`${id}__topic`];
    const tone = answers[`${id}__tone`];
    const audience = (who?.choice ?? info.audiences[0] ?? "here") as Decision["audience"];
    const decision: Decision = {
      personId: id,
      actionId: act.choice,
      speak: (say?.noul ?? 0) >= 0.55 || act.choice === "speak" || act.choice === "cry",
      audience,
      listenerId: audience === "private" ? (info.others.length === 1 ? info.others[0]?.id ?? null : to?.choice ?? null) : null,
      intentWord: word?.choice ?? "tell",
      topic: topic?.choice ?? "work",
      tone: tone?.choice ?? "soft",
      because: `JEV ${Math.round((act.confidence ?? 0) * 100)}%`,
      source: "jev",
      confidence: act.confidence ?? null,
    };
    applyDecision(world, decision);
  }
}
