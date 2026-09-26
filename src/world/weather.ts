import type { Weather } from "./types.js";
import { roll } from "./types.js";

/**
 * Weather as a Markov chain, re-rolled every two in-world hours. Storms are
 * rare and always short. The chain is driven by the persisted world RNG, so
 * the sky's fortune continues across restarts.
 */

const STATES: Weather[] = ["clear", "cloudy", "rain", "wind", "storm"];

const TRANSITIONS: Record<Weather, number[]> = {
  //                clear cloudy rain wind storm
  clear:  [0.62, 0.24, 0.06, 0.08, 0.0],
  cloudy: [0.28, 0.36, 0.2, 0.11, 0.05],
  rain:   [0.14, 0.31, 0.45, 0.05, 0.05],
  wind:   [0.3, 0.16, 0.06, 0.46, 0.02],
  storm:  [0.2, 0.42, 0.3, 0.08, 0.0],
};

export function nextWeather(current: Weather, rng: { rng: number }): Weather {
  const row = TRANSITIONS[current];
  let pick = roll(rng);
  for (let index = 0; index < STATES.length; index += 1) {
    pick -= row[index] ?? 0;
    if (pick <= 0) return STATES[index] ?? current;
  }
  return current;
}
