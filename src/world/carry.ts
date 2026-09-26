import type { Carry, Item, Person, Storage } from "./types.js";
import { carryCapacity, carryCount } from "./types.js";

export { carryCount };

/** Physical goods: personal carry and household storage. */

export function emptyStorage(): Storage {
  return { wood: 0, stone: 0, grain: 0, berries: 0, cloth: 0 };
}

export function addToCarry(person: Person, item: Item, qty: number): number {
  const free = carryCapacity(person.band) - carryCount(person.carry);
  const taken = Math.max(0, Math.min(qty, free));
  if (taken > 0) person.carry[item] = (person.carry[item] ?? 0) + taken;
  return taken;
}

/** Move everything a person carries into their household storage. */
export function depositCarry(person: Person, storages: Record<string, Storage>): { item: Item; qty: number }[] {
  const storage = storages[person.household] ?? emptyStorage();
  const moved: { item: Item; qty: number }[] = [];
  for (const key of Object.keys(person.carry) as Item[]) {
    const qty = person.carry[key] ?? 0;
    if (qty <= 0) continue;
    storage[key] += qty;
    person.carry[key] = 0;
    moved.push({ item: key, qty });
  }
  storages[person.household] = storage;
  return moved;
}

export function storageCount(storage: Storage | undefined, item: Item): number {
  return storage?.[item] ?? 0;
}

/** Take up to qty of an item out of household storage into the person's hands. */
export function withdraw(person: Person, storages: Record<string, Storage>, item: Item, qty: number): number {
  const storage = storages[person.household];
  if (!storage) return 0;
  const have = storage[item] ?? 0;
  const free = carryCapacity(person.band) - carryCount(person.carry);
  const taken = Math.max(0, Math.min(qty, have, free));
  if (taken <= 0) return 0;
  storage[item] = have - taken;
  person.carry[item] = (person.carry[item] ?? 0) + taken;
  return taken;
}

/** Edible stock a household holds. */
export function foodInStorage(storage: Storage | undefined): number {
  return storageCount(storage, "grain") + storageCount(storage, "berries");
}

/** Spend one meal's worth of food from storage; returns false when there is none. */
export function spendMeal(storage: Storage | undefined): boolean {
  if (!storage) return false;
  if ((storage.grain ?? 0) >= 1) {
    storage.grain -= 1;
    return true;
  }
  if ((storage.berries ?? 0) >= 2) {
    storage.berries -= 2;
    return true;
  }
  return false;
}

/** Edible stock a person holds in hand. */
export function foodInCarry(carry: Carry): number {
  return (carry.grain ?? 0) + Math.floor((carry.berries ?? 0) / 2);
}

/** Spend one meal straight from the hands; returns false when they hold none. */
export function spendMealFromCarry(carry: Carry): boolean {
  if ((carry.grain ?? 0) >= 1) {
    carry.grain = (carry.grain ?? 0) - 1;
    return true;
  }
  if ((carry.berries ?? 0) >= 2) {
    carry.berries = (carry.berries ?? 0) - 2;
    return true;
  }
  return false;
}

export function carryLabel(carry: Carry): string {
  const parts = (Object.keys(carry) as Item[]).filter((item) => (carry[item] ?? 0) > 0);
  if (parts.length === 0) return "";
  return parts.map((item) => `${carry[item]} ${item}`).join(", ");
}
