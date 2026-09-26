import type { MemoryLine, Person, World } from "./types.js";

/**
 * The memory hierarchy, all code and no tokens. Episodes land in a weighted
 * ring (eviction by salience, not age), dawns consolidate repeated episodes
 * about the same person into one standing belief, and recall ranks lines by
 * relevance to the present moment instead of raw recency.
 */

export const MEMORY_CAP = 16;
export const BELIEF_CAP = 6;

/** Salience decays to a fifth of its weight across two in-world days. */
const FADE_TICKS = 2880;

export function fadedSalience(line: MemoryLine, tick: number): number {
  const age = Math.max(0, tick - (line.at ?? tick));
  return (line.salience ?? 4) * Math.max(0.2, 1 - age / FADE_TICKS);
}

/** Lay a line down; when the ring overflows, the least salient line fades out. */
export function storeMemory(world: World, person: Person, line: MemoryLine): void {
  person.memory.push(line);
  if (person.memory.length > MEMORY_CAP) {
    let worst = 0;
    let worstScore = Number.POSITIVE_INFINITY;
    person.memory.forEach((item, index) => {
      const score = fadedSalience(item, world.tick);
      if (score < worstScore) {
        worstScore = score;
        worst = index;
      }
    });
    person.memory.splice(worst, 1);
  }
}

function beliefText(name: string, polarity: number, count: number): string {
  return polarity > 0 ? `${name}: ${count} kindnesses remembered.` : `${name}: ${count} slights remembered.`;
}

/**
 * Dawn consolidation: two or more same-polarity episodes about the same
 * person fold into one belief — a ledger line, never invented prose — and
 * the ring slots go free. Repeated slights also sour the bond, through the
 * onSlight callback so this module stays free of simulation imports.
 */
export function consolidate(world: World, person: Person, onSlight: (aboutId: string) => void): void {
  const counts = new Map<string, number>();
  for (const line of person.memory) {
    if (!line.about || !line.polarity) continue;
    const key = `${line.polarity > 0 ? "+" : "-"}${line.about}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return;
  const beliefs = person.beliefs ?? (person.beliefs = []);
  const nameOf = (id: string): string => world.people.find((item) => item.id === id)?.name ?? id;
  for (const [key, count] of counts) {
    if (count < 2) continue;
    const polarity = key.startsWith("+") ? 1 : -1;
    const about = key.slice(1);
    const existing = beliefs.find((belief) => belief.about === about && belief.polarity === polarity);
    if (existing) {
      existing.count += count;
      existing.text = beliefText(nameOf(about), polarity, existing.count);
      existing.at = world.tick;
    } else {
      beliefs.push({ text: beliefText(nameOf(about), polarity, count), at: world.tick, about, polarity, count });
      if (beliefs.length > BELIEF_CAP) beliefs.shift();
    }
    if (polarity < 0) onSlight(about);
  }
  person.memory = person.memory.filter((line) => {
    if (!line.about || !line.polarity) return true;
    return (counts.get(`${line.polarity > 0 ? "+" : "-"}${line.about}`) ?? 0) < 2;
  });
}

/**
 * Recall for the present moment: stored salience, faded with age, plus a
 * bump for lines about whoever is standing here and lines that share words
 * with the current task. Both prompts (spine and brain) ask this instead of
 * taking the newest three.
 */
export function recallFor(
  world: World,
  person: Person,
  context: { nearby?: string[]; task?: string; limit?: number },
): MemoryLine[] {
  const nearby = new Set(context.nearby ?? []);
  const taskWords = new Set(
    (context.task ?? "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4),
  );
  return person.memory
    .map((line) => {
      let score = fadedSalience(line, world.tick);
      if (line.about && nearby.has(line.about)) score += 25;
      if (taskWords.size > 0) {
        const words = new Set(line.text.toLowerCase().split(/[^a-z]+/));
        for (const word of taskWords) {
          if (words.has(word)) {
            score += 15;
            break;
          }
        }
      }
      return { line, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, context.limit ?? 3))
    .map((entry) => entry.line);
}
