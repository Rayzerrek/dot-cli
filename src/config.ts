import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  writeFileSync,
  writeSync,
} from "fs";
import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";
import { homedir } from "os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "path";

import { normalizePath, sameFilesystemPath } from "./paths.js";
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
import { header, logError, logInfo, logSuccess, logWarning } from "./ui.js";

const DOT_DIR = join(homedir(), ".config", "dot");
const DEFAULT_CONFIG_PATH = join(DOT_DIR, "config.jsonc");

type ConfigOrigin = "explicit" | "global" | "repository";

interface ConfigFile {
  content: string;
  path: string;
  origin: ConfigOrigin;
}

function defaultDotfilesDir(): string {
  return normalizePath(process.env.DOTFILES_DIR ?? "~/dotfiles");
}

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
    !["", ".", "..", ".git"].includes(trimmed.toLowerCase()) &&
    name === trimmed &&
    !/[\\/<>:"|?*\x00-\x1f]/.test(name) &&
    !name.endsWith(".") &&
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
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

function resolvePhysicalConfigPath(path: string): string {
  let ancestor = path;
  const missingSegments: string[] = [];
  while (!safeLstat(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return path;
    missingSegments.unshift(basename(ancestor));
    ancestor = parent;
  }
  return join(realpathSync(ancestor), ...missingSegments);
}

function physicalDestinationPath(systemPath: string): string {
  return join(
    resolvePhysicalConfigPath(dirname(systemPath)),
    basename(systemPath),
  );
}

function assertNoOverlappingLinks(
  first: ResolvedLink,
  second: ResolvedLink,
): void {
  const firstPhysical = physicalDestinationPath(first.systemPath);
  const secondPhysical = physicalDestinationPath(second.systemPath);
  if (
    isSameOrNestedPath(first.systemPath, second.systemPath) ||
    isSameOrNestedPath(second.systemPath, first.systemPath) ||
    isSameOrNestedPath(firstPhysical, secondPhysical) ||
    isSameOrNestedPath(secondPhysical, firstPhysical)
  ) {
    throw new Error(
      `Overlapping system paths for ${first.name} and ${second.name}: ${second.systemPath}`,
    );
  }
}

function assertNoCircularLink(link: ResolvedLink, dotfilesDir: string): void {
  const physicalRepository = resolvePhysicalConfigPath(dotfilesDir);
  const physicalSystem = physicalDestinationPath(link.systemPath);
  if (
    isSameOrNestedPath(dotfilesDir, link.systemPath) ||
    isSameOrNestedPath(link.systemPath, dotfilesDir) ||
    isSameOrNestedPath(physicalRepository, physicalSystem) ||
    isSameOrNestedPath(physicalSystem, physicalRepository)
  ) {
    throw new Error(
      `Circular link detected for ${link.name}: ${link.systemPath} ↔ ${link.repoPath}`,
    );
  }
}

function parseJsonc(content: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parse(content, errors, { allowTrailingComma: true });

  const error = errors[0];
  if (error) {
    const precedingLines = content.slice(0, error.offset).split(/\r?\n/);
    const column = (precedingLines.at(-1)?.length ?? 0) + 1;
    throw new Error(
      `${printParseErrorCode(error.error)} at line ${precedingLines.length}, column ${column}`,
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
function isPathString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.includes("\0")
  );
}

function isSystemPathSpec(value: unknown): value is SystemPathSpec {
  if (isPathString(value)) return true;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, entryValue]) => isPlatformKey(key) && isPathString(entryValue),
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
function validateLink(link: unknown, i: number | string): DotfileLink {
  if (!isRecord(link)) {
    throw new Error(`links[${i}] must be an object`);
  }
  if (typeof link.name !== "string" || !isValidLinkName(link.name)) {
    throw new Error(
      `links[${i}].name must be a valid file or directory name without path separators or traversal`,
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
    if (!isPathString(raw.dotfilesDir)) {
      throw new Error(`"dotfilesDir" must be a non-empty path string`);
    }
    config.dotfilesDir = raw.dotfilesDir;
  }

  if ("links" in raw) {
    if (Array.isArray(raw.links)) {
      config.links = raw.links.map(validateLink);
    } else if (isRecord(raw.links)) {
      config.links = Object.entries(raw.links).map(([name, systemPath]) =>
        validateLink({ name, systemPath }, JSON.stringify(name)),
      );
    } else {
      throw new Error(
        `"links" must be an object mapping names to paths or an array of link entries`,
      );
    }
  }

  return config;
}

/**
 * Searches for the first existing configuration file.
 *
 * Global config files keep the historic default `dotfilesDir`. Repository-local
 * config files make freshly cloned dotfiles portable: when `dotfilesDir` is not
 * set, the repository directory is inferred from the config file location.
 *
 * @param configPath - Optional explicit config path supplied by the CLI.
 * @returns An object containing the config content and its absolute path, or `null` if none found.
 */
export function findConfigFile(configPath?: string): ConfigFile | null {
  const repositoryDir = defaultDotfilesDir();
  const candidates: Array<{ path: string; origin: ConfigOrigin }> = configPath
    ? [{ path: normalizePath(configPath), origin: "explicit" }]
    : [
        { path: join(process.cwd(), "dot.config.jsonc"), origin: "repository" },
        { path: join(process.cwd(), "dot.config.json"), origin: "repository" },
        { path: DEFAULT_CONFIG_PATH, origin: "global" },
        { path: join(DOT_DIR, "config.json"), origin: "global" },
        { path: join(homedir(), ".dotrc.jsonc"), origin: "global" },
        { path: join(homedir(), ".dotrc.json"), origin: "global" },
        { path: join(repositoryDir, "config.jsonc"), origin: "repository" },
        { path: join(repositoryDir, "config.json"), origin: "repository" },
        { path: join(repositoryDir, "dot.config.jsonc"), origin: "repository" },
        { path: join(repositoryDir, "dot.config.json"), origin: "repository" },
      ];

  for (const candidate of candidates) {
    let stat = safeLstat(candidate.path);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      try {
        stat = statSync(candidate.path);
      } catch (err) {
        logWarning(
          `Could not read config link at ${candidate.path}: ${errorMessage(err)}`,
        );
        continue;
      }
    }
    if (!stat.isFile()) {
      logWarning(
        `Skipping config candidate because it is not a file: ${candidate.path}`,
      );
      continue;
    }
    try {
      return {
        content: readFileSync(candidate.path, "utf-8"),
        path: candidate.path,
        origin: candidate.origin,
      };
    } catch (err) {
      logWarning(
        `Found config file at ${candidate.path} but failed to read it: ${errorMessage(err)}`,
      );
    }
  }
  return null;
}

function resolveConfigPath(path: string, configFile: string): string {
  return isAbsolute(path) ||
    path === "~" ||
    path.startsWith("~/") ||
    path.startsWith("~\\")
    ? normalizePath(path)
    : normalizePath(join(dirname(configFile), path));
}

/**
 * Loads, parses, and validates the application configuration.
 * Resolves target system paths and repository paths for the current platform.
 *
 * @returns A tagged result containing either the resolved application
 * configuration or a parse/validation error.
 */
export function loadConfiguration(
  configPath?: string,
):
  | { ok: true; config: AppConfig; configPath: string }
  | { ok: false; error: string } {
  const found = findConfigFile(configPath);

  if (!found && configPath) {
    return {
      ok: false,
      error: `Config file not found: ${normalizePath(configPath)}`,
    };
  }

  let configData: DotConfig = {};
  if (found) {
    try {
      configData = validateConfig(parseJsonc(found.content));
    } catch (err) {
      return {
        ok: false,
        error: `Failed to parse config from ${found.path}: ${errorMessage(err)}`,
      };
    }
  } else {
    return {
      ok: false,
      error: `No configuration file found. Run: dot init, then edit links in ${DEFAULT_CONFIG_PATH}`,
    };
  }

  const inferredRepositoryDir =
    found && found.origin !== "global" ? dirname(found.path) : undefined;

  // Resolve dotfiles directory (config > env > repository-local config dir > default)
  const dotfilesDir = configData.dotfilesDir
    ? resolveConfigPath(configData.dotfilesDir, found.path)
    : normalizePath(
        process.env.DOTFILES_DIR ?? inferredRepositoryDir ?? "~/dotfiles",
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
        systemPath: resolveConfigPath(sysPathRaw, found.path),
      };
      assertNoCircularLink(resolvedLink, dotfilesDir);
      for (const existing of links) {
        if (comparablePath(existing.name) === comparablePath(link.name)) {
          throw new Error(`Duplicate link name: ${link.name}`);
        }
        assertNoOverlappingLinks(existing, resolvedLink);
      }
      links.push(resolvedLink);
    }
  } catch (err) {
    return { ok: false, error: `Invalid config: ${errorMessage(err)}` };
  }

  return { ok: true, config: { dotfilesDir, links }, configPath: found.path };
}

/**
 * Builds the starter JSONC config written by `dot init`.
 *
 * The output intentionally preserves comments because the target file is JSONC,
 * not strict JSON.
 */
export function buildInitialConfigContent(dotfilesDir?: string): string {
  return [
    "{",
    '  // Created by dot init. Use "dot add <path>" to register a config.',
    ...(dotfilesDir === undefined
      ? []
      : [`  "dotfilesDir": ${JSON.stringify(dotfilesDir)},`]),
    '  "links": {}',
    "}",
    "",
  ].join("\n");
}

/**
 * Handles the "init" command, creating the default configuration file if missing.
 *
 * @returns `true` when a config already exists or was created successfully; `false` otherwise.
 */
export function handleInit(
  configPath?: string,
  repositoryDir?: string,
): boolean {
  console.log(header("Initialize Dotfiles Configuration"));

  if (repositoryDir !== undefined && !isPathString(repositoryDir)) {
    logError("Dotfiles directory must be a non-empty path.");
    return false;
  }

  const existing = findConfigFile(configPath);
  if (existing) {
    logInfo(`Configuration already exists at: ${existing.path}`);
    return true;
  }

  const destination = configPath
    ? normalizePath(configPath)
    : DEFAULT_CONFIG_PATH;
  if (safeLstat(destination)) {
    logError(
      `Config path already exists but could not be read: ${destination}`,
    );
    return false;
  }
  const dotfilesDir =
    repositoryDir !== undefined
      ? normalizePath(repositoryDir)
      : configPath
        ? undefined
        : process.env.DOTFILES_DIR
          ? normalizePath(process.env.DOTFILES_DIR)
          : "~/dotfiles";

  try {
    mkdirSync(dirname(destination), { recursive: true });
    const fd = openSync(destination, "wx");
    try {
      writeSync(fd, buildInitialConfigContent(dotfilesDir));
    } finally {
      closeSync(fd);
    }
  } catch (err) {
    logError(`Failed to create config at ${destination}: ${errorMessage(err)}`);
    return false;
  }

  logSuccess(`Created configuration at: ${destination}`);
  logInfo(
    "Run: dot add <path>, or edit links in the config, then run: dot link",
  );
  return true;
}

/** Registers an existing file or directory for this platform, preserving JSONC comments. */
export function handleAdd(
  path: string,
  name = basename(normalizePath(path)),
  configPath?: string,
): boolean {
  const systemPath = normalizePath(path);
  if (!isValidLinkName(name) || !isPathString(path)) {
    logError(
      "Invalid config name or path. Use: dot add <path> [--name <name>]",
    );
    return false;
  }
  const sourceStat = safeLstat(systemPath);
  if (
    !sourceStat ||
    (!sourceStat.isFile() &&
      !sourceStat.isDirectory() &&
      !sourceStat.isSymbolicLink())
  ) {
    logError(`Config path is not an existing file or directory: ${systemPath}`);
    return false;
  }
  const platform = currentPlatformKey();
  if (!platform) {
    logError(`Unsupported platform: ${process.platform}`);
    return false;
  }

  let found = findConfigFile(configPath);
  if (!found && !configPath) {
    if (!handleInit()) return false;
    found = findConfigFile();
  }
  if (!found) {
    logError(
      `Config file not found. Run: dot init${configPath ? ` -c "${configPath}"` : ""}`,
    );
    return false;
  }
  const loaded = loadConfiguration(configPath);
  if (!loaded.ok) {
    logError(loaded.error);
    return false;
  }
  const existing = loaded.config.links.find(
    (link) => comparablePath(link.name) === comparablePath(name),
  );
  if (existing) {
    if (comparablePath(existing.systemPath) === comparablePath(systemPath)) {
      logInfo(`Config ${name} is already registered at ${systemPath}.`);
      return true;
    }
    logError(
      `Config ${name} already points to ${existing.systemPath}. Edit ${found.path} to change it.`,
    );
    return false;
  }
  const resolvedLink = {
    name,
    repoPath: join(loaded.config.dotfilesDir, name),
    systemPath,
  };
  try {
    assertNoCircularLink(resolvedLink, loaded.config.dotfilesDir);
    if (
      sourceStat.isSymbolicLink() &&
      !sameFilesystemPath(
        resolve(dirname(systemPath), readlinkSync(systemPath)),
        resolvedLink.repoPath,
      )
    ) {
      logError(
        `Path is already a link to another location: ${systemPath}. Add a physical file or use --name matching its repository source.`,
      );
      return false;
    }
    for (const link of loaded.config.links) {
      assertNoOverlappingLinks(link, resolvedLink);
    }
    const raw = parseJsonc(found.content);
    if (!isRecord(raw)) {
      logError(`Config must be a JSON object: ${found.path}`);
      return false;
    }
    const homeRelative = relative(homedir(), systemPath);
    const portablePath = isSameOrNestedPath(homedir(), systemPath)
      ? `~/${homeRelative.split(sep).join("/")}`
      : systemPath;
    const value = { [platform]: portablePath };
    const formattingOptions = {
      insertSpaces: true,
      tabSize: 2,
      eol: found.content.includes("\r\n") ? "\r\n" : "\n",
    };
    let content: string;
    if (Array.isArray(raw.links)) {
      const entry = raw.links.findIndex(
        (link: unknown) => isRecord(link) && link.name === name,
      );
      const edits =
        entry < 0
          ? modify(
              found.content,
              ["links", -1],
              { name, systemPath: value },
              { formattingOptions, isArrayInsertion: true },
            )
          : modify(
              found.content,
              ["links", entry, "systemPath", platform],
              portablePath,
              { formattingOptions },
            );
      content = applyEdits(found.content, edits);
    } else {
      content = applyEdits(
        found.content,
        modify(found.content, ["links", name, platform], portablePath, {
          formattingOptions,
        }),
      );
    }
    validateConfig(parseJsonc(content));
    writeFileSync(found.path, content);
    logSuccess(`Registered ${name} in ${found.path}`);
    logInfo(`Next: dot link${configPath ? ` -c "${found.path}"` : ""}`);
    return true;
  } catch (err) {
    logError(`Failed to register ${name}: ${errorMessage(err)}`);
    return false;
  }
}
