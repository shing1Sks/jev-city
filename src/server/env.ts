import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const rootDir = resolve(here, "../..");
export const dataDir = resolve(rootDir, "data");

export function loadEnv(): void {
  const path = resolve(rootDir, ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) continue;
    const name = match[1];
    if (!name || process.env[name] !== undefined) continue;
    let value = match[2] ?? "";
    value = value.trim().replace(/^['"]|['"]$/g, "");
    process.env[name] = value;
  }
  if (!process.env.TYPESAFE_API_KEY && process.env.JEV) {
    process.env.TYPESAFE_API_KEY = process.env.JEV;
  }
}
