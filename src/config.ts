import { createHash } from "crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "fs";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import { homedir } from "os";
import { isAbsolute, join, relative } from "path";

import { normalizePath } from "./paths.js";
import { errorMessage, safeLstat } from "./system.js";
import {
  type AppConfig,
  type DotConfig,
  type DotfileLink,
  PLATFORM_KEYS,
  type PlatformKey,
  type ResolvedLink,
  type SystemPathSpec,
} from "./types.js";
import {
  gray,
  header,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  promptInput,
} from "./ui.js";

// Default location for config + cache files (~/.config/dot)
const DOT_DIR = join(homedir(), ".config", "dot");
const DEFAULT_CONFIG_PATH = join(DOT_DIR, "config.jsonc");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlatformKey(value: string): value is PlatformKey {
  return PLATFORM_KEYS.some((platformKey) => platformKey === value);
}

function isValidLinkName(name: string): boolean {
  const trimmed = name.trim();
  const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  return (
    !["", ".", ".."].includes(trimmed) &&
    !/[\\/]/.test(name) &&
    !windowsReservedName.test(trimmed)
  );
}

function currentPlatformKey(): PlatformKey | undefined {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return undefined;
  }
}

/**
 * Resolves a system path specification to a single path string for the current platform.
 *
 * @param pathSpec - A string path or a platform-specific mapping object.
 * @returns The resolved system path, or `undefined` if the current platform is unsupported.
 */
function resolveSystemPath(pathSpec: SystemPathSpec): string | undefined {
  if (typeof pathSpec === "string") return pathSpec;
  const key = currentPlatformKey();
  return key ? pathSpec[key] : undefined;
}

function comparablePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isSameOrNestedPath(parent: string, child: string): boolean {
  const rel = relative(comparablePath(parent), comparablePath(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertNoCircularLink(link: ResolvedLink): void {
  if (
    isSameOrNestedPath(link.repoPath, link.systemPath) ||
    isSameOrNestedPath(link.systemPath, link.repoPath)
  ) {
    throw new Error(
      `Circular link detected for ${link.name}: ${link.systemPath} ↔ ${link.repoPath}`,
    );
  }
}

function parseJsonc(content: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parse(content, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const error = errors[0];
    throw new Error(
      `${printParseErrorCode(error.error)} at offset ${error.offset}`,
    );
  }

  return parsed;
}

/**
 * Validates whether a value is a valid SystemPathSpec.
 *
 * @param value - The value to check.
 * @returns `true` if valid, otherwise `false`.
 */
function isSystemPathSpec(value: unknown): value is SystemPathSpec {
  if (typeof value === "string") return true;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, entryValue]) =>
        isPlatformKey(key) && typeof entryValue === "string",
    )
  );
}

/**
 * Validates a single dotfile link entry.
 *
 * @param link - The raw link object to validate.
 * @param i - The index of the link in the array (used for error reporting).
 * @returns A validated `DotfileLink` object.
 * @throws An error if the link format is invalid.
 */
function validateLink(link: unknown, i: number): DotfileLink {
  if (!isRecord(link)) {
    throw new Error(`links[${i}] must be an object`);
  }
  if (typeof link.name !== "string" || !isValidLinkName(link.name)) {
    throw new Error(
      `links[${i}].name must be a non-empty directory name without path separators or traversal`,
    );
  }
  if (!("systemPath" in link) || !isSystemPathSpec(link.systemPath)) {
    throw new Error(
      `links[${i}].systemPath must be a string or { windows?, macos?, linux? }`,
    );
  }
  return { name: link.name, systemPath: link.systemPath };
}

/**
 * Validates the raw configuration object.
 *
 * @param raw - The raw configuration object.
 * @returns A validated `DotConfig` object.
 * @throws An error if the configuration has an invalid schema.
 */
function validateConfig(raw: unknown): DotConfig {
  if (!isRecord(raw)) {
    throw new Error("Config must be a JSON object");
  }
  const config: DotConfig = {};

  if ("dotfilesDir" in raw) {
    if (typeof raw.dotfilesDir !== "string") {
      throw new Error(`"dotfilesDir" must be a string`);
    }
    config.dotfilesDir = raw.dotfilesDir;
  }

  if ("links" in raw) {
    if (!Array.isArray(raw.links)) {
      throw new Error(`"links" must be an array`);
    }
    config.links = raw.links.map(validateLink);
  }

  return config;
}

/**
 * Searches for the first existing configuration file in the conventional candidates list.
 *
 * @returns An object containing the config content and its absolute path, or `null` if none found.
 */
export function findConfigFile(): { content: string; path: string } | null {
  const candidates = [
    DEFAULT_CONFIG_PATH,
    join(DOT_DIR, "config.json"),
    join(homedir(), ".dotrc.jsonc"),
    join(homedir(), ".dotrc.json"),
  ];

  for (const path of candidates) {
    const stat = safeLstat(path);
    if (!stat) continue;
    if (!stat.isFile()) {
      logWarning(`Skipping config candidate because it is not a file: ${path}`);
      continue;
    }
    try {
      return { content: readFileSync(path, "utf-8"), path };
    } catch (err) {
      logWarning(
        `Found config file at ${path} but failed to read it: ${errorMessage(err)}`,
      );
    }
  }
  return null;
}

/**
 * Detects if the configuration content has changed since the last execution and logs a notice.
 * Stores an MD5 hash of the config in `~/.config/dot/.config-hash`.
 *
 * @param content - The current config file content.
 * @param path - The path to the config file.
 */
function notifyOnConfigChange(content: string, path: string): void {
  const hashFile = join(DOT_DIR, ".config-hash");
  const currentHash = createHash("md5").update(content).digest("hex");
  let previousHash = "";
  try {
    previousHash = readFileSync(hashFile, "utf-8").trim();
  } catch {}
  if (previousHash && previousHash !== currentHash) {
    logInfo(`Configuration changed (${path})`);
  }
  try {
    mkdirSync(DOT_DIR, { recursive: true });
    writeFileSync(hashFile, currentHash);
  } catch (err) {
    logWarning(`Could not update config change cache: ${errorMessage(err)}`);
  }
}

/**
 * Loads, parses, and validates the application configuration.
 * Resolves target system paths and repository paths for the current platform.
 *
 * @returns A tagged result containing either the resolved application
 * configuration or a parse/validation error.
 */
export function loadConfiguration():
  | { ok: true; config: AppConfig }
  | { ok: false; error: string } {
  const found = findConfigFile();

  let configData: DotConfig = {};
  if (found) {
    try {
      configData = validateConfig(parseJsonc(found.content));
      notifyOnConfigChange(found.content, found.path);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to parse config from ${found.path}: ${errorMessage(err)}`,
      };
    }
  } else {
    logWarning(
      `No configuration file found. Create one at ${DEFAULT_CONFIG_PATH}`,
    );
    logInfo(`See: https://github.com/Rayzerrek/dot-cli#configuration`);
  }

  // Resolve dotfiles directory (config > env > default)
  const dotfilesDir = normalizePath(
    configData.dotfilesDir ?? process.env.DOTFILES_DIR ?? "~/dotfiles",
  );

  // Resolve links for the current platform
  const links: ResolvedLink[] = [];
  try {
    for (const link of configData.links ?? []) {
      const sysPathRaw = resolveSystemPath(link.systemPath);
      if (!sysPathRaw) continue;
      const resolvedLink = {
        name: link.name,
        repoPath: normalizePath(join(dotfilesDir, link.name)),
        systemPath: normalizePath(sysPathRaw),
      };
      assertNoCircularLink(resolvedLink);
      links.push(resolvedLink);
    }
  } catch (err) {
    return { ok: false, error: `Invalid config: ${errorMessage(err)}` };
  }

  return { ok: true, config: { dotfilesDir, links } };
}

/**
 * Builds the starter JSONC config written by `dot init`.
 *
 * The output intentionally preserves comments because the target file is JSONC,
 * not strict JSON.
 */
export function buildInitialConfigContent(dotfilesDir: string): string {
  return [
    "{",
    '  // Created by dot init. Add entries to links, then run "dot link".',
    `  "dotfilesDir": ${JSON.stringify(dotfilesDir)},`,
    '  "links": []',
    "}",
    "",
  ].join("\n");
}

/**
 * Handles the "init" command, creating the default configuration file if missing.
 *
 * @returns `true` when a config already exists or was created successfully; `false` otherwise.
 */
export function handleInit(): boolean {
  console.log(header("Initialize Dotfiles Configuration"));

  const existing = findConfigFile();
  if (existing) {
    logInfo(`Configuration already exists at: ${existing.path}`);
    return true;
  }

  const answer = promptInput(
    `Dotfiles repository directory ${gray("[~/dotfiles]")}: `,
  );
  const dotfilesDir = answer || "~/dotfiles";

  try {
    mkdirSync(DOT_DIR, { recursive: true });
    const fd = openSync(DEFAULT_CONFIG_PATH, "wx");
    try {
      writeSync(fd, buildInitialConfigContent(dotfilesDir));
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    logError(
      `Failed to create config at ${DEFAULT_CONFIG_PATH}: ${errorMessage(err)}`,
    );
    return false;
  }

  logSuccess(`Created configuration at: ${DEFAULT_CONFIG_PATH}`);
  logInfo("Edit links in the config, then run: dot link");
  return true;
}
