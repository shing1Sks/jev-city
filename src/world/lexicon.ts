import type { Band } from "./types.js";

export interface Lexeme {
  id: string;
  label: string;
}

export interface Tone extends Lexeme {
  emoji: string;
}

export const INTENTS: Lexeme[] = [
  { id: "greet", label: "hello" },
  { id: "bye", label: "goodbye" },
  { id: "yes", label: "agree" },
  { id: "no", label: "refuse" },
  { id: "maybe", label: "unsure" },
  { id: "need", label: "must have" },
  { id: "want", label: "would like" },
  { id: "have", label: "I hold this" },
  { id: "give", label: "take this" },
  { id: "come", label: "move toward me" },
  { id: "go", label: "move away" },
  { id: "stay", label: "remain" },
  { id: "stop", label: "halt" },
  { id: "help", label: "aid me" },
  { id: "look", label: "pay attention" },
  { id: "tell", label: "here is news" },
  { id: "ask", label: "I am asking" },
  { id: "like", label: "this pleases me" },
  { id: "dislike", label: "this bothers me" },
  { id: "fear", label: "this scares me" },
  { id: "thanks", label: "I am grateful" },
  { id: "sorry", label: "I regret this" },
  { id: "play", label: "let's play" },
  { id: "work", label: "I am working" },
  { id: "rest", label: "I am resting" },
  { id: "eat", label: "time to eat" },
  { id: "danger", label: "this is unsafe" },
  { id: "safe", label: "this is safe" },
];

export const TOPICS: Lexeme[] = [
  { id: "food", label: "food" },
  { id: "water", label: "water" },
  { id: "home", label: "home" },
  { id: "bed", label: "bed" },
  { id: "work", label: "work" },
  { id: "rest", label: "rest" },
  { id: "child", label: "a child" },
  { id: "rain", label: "rain" },
  { id: "sun", label: "sun" },
  { id: "crop", label: "the crop" },
  { id: "wood", label: "wood" },
  { id: "cloth", label: "cloth" },
  { id: "hurt", label: "hurt" },
  { id: "friend", label: "a friend" },
  { id: "path", label: "the path" },
  { id: "night", label: "night" },
  { id: "play", label: "play" },
  { id: "tool", label: "a tool" },
  { id: "help", label: "help" },
  { id: "family", label: "family" },
];

export const TONES: Tone[] = [
  { id: "joy", label: "glad", emoji: "😀" },
  { id: "soft", label: "gentle", emoji: "🙂" },
  { id: "sad", label: "sad", emoji: "😢" },
  { id: "angry", label: "angry", emoji: "😠" },
  { id: "fear", label: "afraid", emoji: "😨" },
  { id: "love", label: "fond", emoji: "❤️" },
  { id: "please", label: "please or thanks", emoji: "🙏" },
  { id: "urgent", label: "urgent", emoji: "❗" },
  { id: "ask", label: "asking", emoji: "❓" },
  { id: "tired", label: "tired", emoji: "😴" },
  { id: "hunger", label: "hungry", emoji: "🍽️" },
  { id: "yes", label: "yes", emoji: "✅" },
  { id: "no", label: "no", emoji: "❌" },
  { id: "rain", label: "weather", emoji: "🌧️" },
  { id: "guard", label: "protect", emoji: "🛡️" },
];

const TODDLER_INTENTS = ["greet", "yes", "no", "need", "want", "play", "eat"];
const CHILD_INTENTS = [
  ...TODDLER_INTENTS,
  "come",
  "go",
  "stay",
  "help",
  "look",
  "like",
  "fear",
  "thanks",
  "sorry",
  "rest",
  "tell",
];
const TODDLER_TOPICS = ["food", "home", "play", "help", "water"];
const CHILD_TOPICS = [...TODDLER_TOPICS, "sun", "rain", "friend", "hurt", "bed", "family"];
const TODDLER_TONES = ["joy", "sad", "fear", "please", "hunger", "ask"];

export function allowedIntentIds(band: Band): string[] {
  if (band === "toddler") return TODDLER_INTENTS;
  if (band === "child") return CHILD_INTENTS;
  return INTENTS.map((item) => item.id);
}

export function allowedTopicIds(band: Band): string[] {
  if (band === "toddler") return TODDLER_TOPICS;
  if (band === "child") return CHILD_TOPICS;
  return TOPICS.map((item) => item.id);
}

export function allowedToneIds(band: Band): string[] {
  if (band === "toddler") return TODDLER_TONES;
  return TONES.map((item) => item.id);
}

export function toneEmoji(id: string): string {
  return TONES.find((tone) => tone.id === id)?.emoji ?? "";
}

export function renderUtterance(intentWord: string, topic: string, tone: string): string {
  return `${intentWord.toUpperCase()} ${topic} ${toneEmoji(tone)}`.trim();
}
