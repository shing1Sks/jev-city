import type { BuildSite, Carry, Item, Person, ProjectKind, Vec } from "./types.js";
import { clamp } from "./types.js";

/**
 * Earned construction: mark a site, carry materials to it, raise it stage by
 * stage. The finished building becomes a permanent expansion on the map.
 */

export const RECIPES: Partial<Record<ProjectKind, { need: Carry; stages: number; label: string }>> = {
  house: { need: { wood: 6, stone: 4 }, stages: 3, label: "house" },
  stall: { need: { wood: 4, stone: 1 }, stages: 2, label: "stall" },
  shrine: { need: { stone: 5 }, stages: 2, label: "shrine" },
  watch: { need: { wood: 3, stone: 3 }, stages: 2, label: "watch" },
};

export function canMarkSite(kind: ProjectKind): boolean {
  return Boolean(RECIPES[kind]);
}

export function markSite(owner: Person, kind: ProjectKind, at: Vec, serial: number): BuildSite | null {
  const recipe = RECIPES[kind];
  if (!recipe) return null;
  const need: Carry = { ...recipe.need };
  return {
    id: `${owner.id}-${kind}-${serial}`,
    ownerId: owner.id,
    kind,
    label: `${owner.name}'s ${recipe.label}`,
    x: clamp(at.x, 5, 95),
    y: clamp(at.y, 8, 92),
    need,
    have: {},
    stage: 0,
    stages: recipe.stages,
  };
}

export function siteNeeds(site: BuildSite): number {
  return (Object.keys(site.need) as Item[]).reduce((sum, item) => sum + Math.max(0, (site.need[item] ?? 0) - (site.have[item] ?? 0)), 0);
}

/** Deposit carried materials onto the site. Returns the items actually left. */
export function deliverToSite(person: Person, site: BuildSite): { item: Item; qty: number }[] {
  const moved: { item: Item; qty: number }[] = [];
  for (const key of Object.keys(site.need) as Item[]) {
    const owed = Math.max(0, (site.need[key] ?? 0) - (site.have[key] ?? 0));
    const held = person.carry[key] ?? 0;
    const give = Math.min(owed, held);
    if (give <= 0) continue;
    site.have[key] = (site.have[key] ?? 0) + give;
    person.carry[key] = held - give;
    moved.push({ item: key, qty: give });
  }
  return moved;
}

/** One build pass: materials already on site convert into raised stage. Returns true on progress. */
export function raiseStage(site: BuildSite): boolean {
  if (siteNeeds(site) > 0) return false;
  if (site.stage >= site.stages) return false;
  site.stage += 1;
  return true;
}

export function siteComplete(site: BuildSite): boolean {
  return site.stage >= site.stages;
}
