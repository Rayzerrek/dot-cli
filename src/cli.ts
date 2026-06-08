import { handleInit, loadConfiguration } from "./config.js";
import { handleDeploy } from "./deploy.js";
import { handleUpdate } from "./git.js";
import { handleLink } from "./links.js";
import { handleStatus } from "./status.js";
import { logError, printHelp } from "./ui.js";
import { VERSION } from "./version.js";

import type { AppConfig } from "./types.js";

function runWithConfiguration(
  handler: (config: AppConfig) => boolean,
  configPath?: string,
): boolean {
  const result = loadConfiguration(configPath);
  if (!result.ok) {
    logError(result.error);
    return false;
  }
  return handler(result.config);
}

function parseCliArgs(
  args: string[],
):
  | { ok: true; args: string[]; configPath?: string }
  | { ok: false; error: string } {
  const parsedArgs: string[] = [];
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      const value = args[i + 1];
      if (value === undefined) {
        return { ok: false, error: `${arg} requires a file path` };
      }
      configPath = value;
      i += 1;
      continue;
    }
    parsedArgs.push(arg);
  }

  return configPath === undefined
    ? { ok: true, args: parsedArgs }
    : { ok: true, args: parsedArgs, configPath };
}

/**
 * Dispatches the requested CLI command, loading configuration only for commands
 * that need it, and records a failing process exit code when the command reports failure.
 *
 * The command handlers return booleans instead of exiting directly so the CLI
 * flow has a single place responsible for process-level side effects.
 */
export function main(args: string[] = process.argv.slice(2)): void {
  const parsed = parseCliArgs(args);
  if (!parsed.ok) {
    logError(parsed.error);
    printHelp();
    process.exitCode = 1;
    return;
  }

  const command = parsed.args[0]?.toLowerCase();

  let ok = true;
  switch (command) {
    case "init":
      ok = handleInit();
      break;
    case "version":
    case "-v":
    case "--version":
      console.log(VERSION);
      break;
    case "status": {
      ok = runWithConfiguration(handleStatus, parsed.configPath);
      break;
    }
    case "link": {
      ok = runWithConfiguration(handleLink, parsed.configPath);
      break;
    }
    case "deploy": {
      ok = runWithConfiguration(handleDeploy, parsed.configPath);
      break;
    }
    case "update": {
      const msg = parsed.args.slice(1).join(" ");
      ok = runWithConfiguration(
        (config) => handleUpdate(config, msg || undefined),
        parsed.configPath,
      );
      break;
    }
    case "help":
    case "-h":
    case "--help":
    case undefined:
      printHelp();
      break;
    default:
      logError(`Unknown command: "${parsed.args[0]}"`);
      printHelp();
      ok = false;
  }

  if (!ok) {
    process.exitCode = 1;
  }
}
