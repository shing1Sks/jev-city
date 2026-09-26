import { placeOf } from "./map.js";
import { storeMemory } from "./memory.js";
import { bondKey, clamp, clockLabel, type Item, type Person, type PlaceId, type World } from "./types.js";

/**
 * Barter at the market and at stalls the town has raised. The spine never
 * authors this: two households whose stores complement each other swap two
 * units for two when their people stand together at a trade spot. It is a
 * scene — a log line, a word spoken, a memory, a warmer bond.
 */

/** How close two people must stand to a trade spot to do business. */
const TRADE_RANGE = 2.5;

/** How far the news of a trade carries. */
const EARSHOT = 12;

/** A household must hold at least this much to spare two units. */
const SURPLUS = 4;

/** A household is only interested in an item it has run out of. */
const NEED = 1;

const GOODS: Item[] = ["wood", "stone", "grain", "berries", "cloth"];

const PLACES: PlaceId[] = ["grove", "field", "well", "vale", "square", "hearth", "market", "porch", "mill", "rise"];

interface TradeSpot {
  x: number;
  y: number;
  place: PlaceId;
}

function tradeSpots(world: World): TradeSpot[] {
  const market = placeOf("market");
  const spots: TradeSpot[] = [{ x: market.x, y: market.y, place: "market" }];
  for (const work of world.expansions) {
    if (work.kind !== "stall") continue;
    let best: PlaceId = "square";
    let bestDist = Number.POSITIVE_INFINITY;
    for (const id of PLACES) {
      const at = placeOf(id);
      const d = Math.hypot(at.x - work.x, at.y - work.y);
      if (d < bestDist) {
        best = id;
        bestDist = d;
      }
    }
    spots.push({ x: work.x, y: work.y, place: best });
  }
  return spots;
}

function traderOK(person: Person): boolean {
  return person.alive && (person.band === "youth" || person.band === "adult" || person.band === "elder");
}

function near(spot: TradeSpot, person: Person): boolean {
  return Number.isFinite(person.x) && Number.isFinite(person.y) && Math.hypot(person.x - spot.x, person.y - spot.y) <= TRADE_RANGE;
}

/** What a would give b, if the two stores complement: first match in fixed order. */
function findTrade(a: Person, b: Person, world: World): { give: Item; take: Item } | null {
  const aStore = world.storages[a.household];
  const bStore = world.storages[b.household];
  if (!aStore || !bStore) return null;
  for (const give of GOODS) {
    for (const take of GOODS) {
      if (give === take) continue;
      if ((aStore[give] ?? 0) >= SURPLUS && (bStore[give] ?? 0) <= NEED && (bStore[take] ?? 0) >= SURPLUS && (aStore[take] ?? 0) <= NEED) {
        return { give, take };
      }
    }
  }
  return null;
}

/** The town's trade sweep: at most one scene per call, first eligible spot wins. */
export function tradeAtStalls(world: World): void {
  for (const spot of tradeSpots(world)) {
    const here = world.people.filter((person) => traderOK(person) && near(spot, person));
    for (let i = 0; i < here.length; i += 1) {
      for (let j = i + 1; j < here.length; j += 1) {
        const a = here[i];
        const b = here[j];
        if (!a || !b || a.household === b.household) continue;
        const trade = findTrade(a, b, world);
        if (!trade) continue;
        doTrade(world, spot, a, b, trade);
        return;
      }
    }
  }
}

function doTrade(world: World, spot: TradeSpot, a: Person, b: Person, trade: { give: Item; take: Item }): void {
  const aStore = world.storages[a.household];
  const bStore = world.storages[b.household];
  if (!aStore || !bStore) return;
  aStore[trade.give] -= 2;
  aStore[trade.take] += 2;
  bStore[trade.take] -= 2;
  bStore[trade.give] += 2;

  const by = spot.place === "market" ? "at the market" : `by ${placeOf(spot.place).name}`;
  const text = `${a.name} and ${b.name} trade 2 ${trade.give} for 2 ${trade.take} ${by}.`;
  world.log.push({
    id: world.nextEventId,
    tick: world.tick,
    clock: clockLabel(world.hour, world.minute),
    kind: "work",
    speakerId: a.id,
    audience: "here",
    listenerId: b.id,
    place: spot.place,
    text,
    heardBy: world.people
      .filter((person) => person.alive && Math.hypot(person.x - spot.x, person.y - spot.y) <= EARSHOT)
      .map((person) => person.id),
  });
  world.nextEventId += 1;
  if (world.log.length > 80) world.log.shift();
  world.uncompiled += 1;

  // One shared bond between the two households' traders warms once, not per trader.
  const bond = world.bonds.find((item) => bondKey(item.a, item.b) === bondKey(a.id, b.id));
  if (bond) bond.score = clamp(bond.score + 3, 0, 100);

  for (const [person, other, gave, got] of [
    [a, b, trade.give, trade.take],
    [b, a, trade.take, trade.give],
  ] as const) {
    person.belonging = clamp(person.belonging + 1, 0, 100);
    person.speech = { text: `trade 2 ${gave} for 2 ${got}`, audience: "here", listenerId: other.id, ticks: 6 };
    storeMemory(world, person, {
      clock: clockLabel(world.hour, world.minute),
      text: `Traded 2 ${gave} for 2 ${got} with ${other.name}.`,
      private: false,
      about: other.id,
      polarity: 1,
      salience: 6,
      at: world.tick,
    });
  }
}
