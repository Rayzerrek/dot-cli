import { homedir } from "os";
import { join, normalize, resolve } from "path";

/**
 * Resolves and normalizes a system path, expanding home directory shortcuts (~).
 *
 * @param p - The raw path to normalize.
 * @returns The absolute, normalized path.
 */
export function normalizePath(p: string): string {
  if (p === "~") return resolve(homedir());

  const hasHomePrefix = p.startsWith("~/") || p.startsWith("~\\");
  const expanded = hasHomePrefix ? join(homedir(), p.slice(2)) : p;
  return resolve(normalize(expanded));
}
