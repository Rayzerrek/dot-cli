import { handleInit, loadConfiguration } from "./config.js";
import { handleUpdate } from "./git.js";
import { handleLink } from "./links.js";
import { handleStatus } from "./status.js";
import type { AppConfig } from "./types.js";
import { logError, printHelp } from "./ui.js";
import { VERSION } from "./version.js";

function runWithConfiguration(handler: (config: AppConfig) => boolean): boolean {
  const result = loadConfiguration();
  if (!result.ok) {
    logError(result.error);
    return false;
  }
  return handler(result.config);
}

/**
 * Dispatches the requested CLI command, loading configuration only for commands
 * that need it, and records a failing process exit code when the command reports failure.
 *
 * The command handlers return booleans instead of exiting directly so the CLI
 * flow has a single place responsible for process-level side effects.
 */
export function main(args: string[] = process.argv.slice(2)): void {
  const command = args[0]?.toLowerCase();

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
      ok = runWithConfiguration(handleStatus);
      break;
    }
    case "link": {
      ok = runWithConfiguration(handleLink);
      break;
    }
    case "update": {
      const msg = args.slice(1).join(" ");
      ok = runWithConfiguration((config) =>
        handleUpdate(config, msg || undefined),
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
      logError(`Unknown command: "${args[0]}"`);
      printHelp();
      ok = false;
  }

  if (!ok) {
    process.exitCode = 1;
  }
}
