import { allowedIntentIds, allowedToneIds, allowedTopicIds, renderUtterance } from "./lexicon.js";
import type { ActionOption, Audience, Decision, Person, Utterance, World } from "./types.js";

export function othersHere(person: Person, world: World): Person[] {
  return world.people.filter((other) => other.id !== person.id && other.place === person.place);
}

export function legalAudiences(person: Person, world: World): Audience[] {
  const others = othersHere(person, world);
  const audiences: Audience[] = [];
  if (others.length > 0) audiences.push("here");
  const canPrivate =
    person.band === "toddler"
      ? others.some((other) => person.guardians.includes(other.id))
      : others.length > 0;
  if (canPrivate) audiences.push("private");
  if ((person.band === "adult" || person.band === "elder") && person.place === "square") {
    audiences.push("town");
  }
  if (audiences.length === 0) audiences.push("here");
  return audiences;
}

export function whoHears(world: World, speaker: Person, audience: Audience, listenerId: string | null): Person[] {
  if (audience === "private") {
    const listener = world.people.find((person) => person.id === listenerId);
    return listener && listener.id !== speaker.id ? [listener] : [];
  }
  if (audience === "town") return world.people.filter((person) => person.id !== speaker.id);
  return othersHere(speaker, world);
}

export function sanitizeSpeech(
  person: Person,
  world: World,
  decision: Pick<Decision, "speak" | "audience" | "listenerId" | "intentWord" | "topic" | "tone">,
  option: ActionOption,
): { speak: boolean; utterance: Utterance | null; audience: Audience; listenerId: string | null } {
  const speak = decision.speak || option.kind === "speak";
  if (!speak) {
    return { speak: false, utterance: null, audience: "here", listenerId: null };
  }

  const intents = allowedIntentIds(person.band);
  const topics = allowedTopicIds(person.band);
  const tones = allowedToneIds(person.band);
  const intentWord = intents.includes(decision.intentWord) ? decision.intentWord : intents[0] ?? "need";
  const topic = topics.includes(decision.topic) ? decision.topic : topics[0] ?? "help";
  const tone = tones.includes(decision.tone) ? decision.tone : tones[0] ?? "soft";

  let audience = decision.audience;
  const audiences = legalAudiences(person, world);
  if (!audiences.includes(audience)) audience = audiences[0] ?? "here";

  let listenerId = decision.listenerId;
  const others = othersHere(person, world);
  if (audience === "private") {
    if (!listenerId || !others.some((other) => other.id === listenerId)) {
      const guardian = others.find((other) => person.guardians.includes(other.id));
      listenerId = guardian?.id ?? others[0]?.id ?? null;
    }
    if (!listenerId) audience = "here";
  } else {
    listenerId = null;
  }
  if (audience === "town" && (person.place !== "square" || (person.band !== "adult" && person.band !== "elder"))) {
    audience = audiences.includes("here") ? "here" : audiences[0] ?? "here";
  }

  return {
    speak: true,
    audience,
    listenerId,
    utterance: { intentWord, topic, tone, text: renderUtterance(intentWord, topic, tone) },
  };
}
