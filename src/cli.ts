import { handleAdd, handleInit, loadConfiguration } from "./config.js";
import { handleDeploy } from "./deploy.js";
import { handlePull, handleUpdate } from "./git.js";
import { handleLink } from "./links.js";
import { handleStatus } from "./status.js";
import { logError, logInfo, printCommandHelp, printHelp } from "./ui.js";
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
  logInfo(`Config: ${result.configPath}`);
  return handler(result.config);
}

function parseCliArgs(
  args: string[],
):
  | { ok: true; args: string[]; configPath?: string }
  | { ok: false; error: string } {
  const parsedArgs: string[] = [];
  let configPath: string | undefined;
  let optionsEnded = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      optionsEnded = true;
      parsedArgs.push(arg);
      continue;
    }
    if (
      !optionsEnded &&
      (arg === "--config" || arg === "-c" || arg.startsWith("--config="))
    ) {
      const inlineValue = arg.startsWith("--config=")
        ? arg.slice("--config=".length)
        : undefined;
      const value = inlineValue ?? args[i + 1];
      if (
        value === undefined ||
        !value.trim() ||
        (inlineValue === undefined && value.startsWith("-"))
      ) {
        return { ok: false, error: `${arg} requires a file path` };
      }
      if (configPath !== undefined)
        return { ok: false, error: "Specify --config only once" };
      configPath = value;
      if (inlineValue === undefined) i += 1;
      continue;
    }
    parsedArgs.push(arg);
  }

  return configPath === undefined
    ? { ok: true, args: parsedArgs }
    : { ok: true, args: parsedArgs, configPath };
}

function parseAddArgs(
  args: string[],
): { ok: true; path: string; name?: string } | { ok: false; error: string } {
  let path: string | undefined;
  let name: string | undefined;
  let optionsEnded = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
    } else if (!optionsEnded && (arg === "--name" || arg === "-n")) {
      const value = args[i + 1];
      if (!value?.trim() || value.startsWith("-"))
        return { ok: false, error: `${arg} requires a name` };
      if (name !== undefined)
        return { ok: false, error: "Specify --name only once" };
      name = value;
      i += 1;
    } else if ((!optionsEnded && arg.startsWith("-")) || path !== undefined) {
      return {
        ok: false,
        error: `Unexpected argument: "${arg}". Run: dot add --help`,
      };
    } else {
      path = arg;
    }
  }
  return path?.trim()
    ? { ok: true, path, name }
    : { ok: false, error: "A path is required. Run: dot add <path>" };
}

function parseUpdateArgs(
  args: string[],
):
  | { ok: true; autoApprove: boolean; dryRun: boolean; commitMessage?: string }
  | { ok: false; error: string } {
  const messageParts: string[] = [];
  let autoApprove = false;
  let dryRun = false;
  let optionsEnded = false;

  for (const arg of args.slice(1)) {
    if (!optionsEnded && arg === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && (arg === "--yes" || arg === "-y")) {
      autoApprove = true;
      continue;
    }
    if (!optionsEnded && arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!optionsEnded && arg.startsWith("-")) {
      return { ok: false, error: `Unknown update option: "${arg}"` };
    }
    messageParts.push(arg);
  }

  const commitMessage = messageParts.join(" ");
  if (messageParts.length > 0 && !commitMessage.trim())
    return { ok: false, error: "Commit message cannot be blank" };
  return commitMessage
    ? { ok: true, autoApprove, dryRun, commitMessage }
    : { ok: true, autoApprove, dryRun };
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
  const commandArgs = parsed.args.slice(1);
  const optionsEnd = commandArgs.indexOf("--");
  const options =
    optionsEnd < 0 ? commandArgs : commandArgs.slice(0, optionsEnd);

  if (
    options.some((arg) => arg === "--help" || arg === "-h") &&
    printCommandHelp(command ?? "")
  ) {
    return;
  }

  if (
    command !== undefined &&
    ["status", "version", "-v", "--version"].includes(command) &&
    commandArgs.length > 0
  ) {
    logError(
      `Unexpected argument: "${commandArgs[0]}". Run: dot ${command} --help`,
    );
    process.exitCode = 1;
    return;
  }

  let ok = true;
  switch (command) {
    case "init":
      if (commandArgs.length > 1 || commandArgs[0]?.startsWith("-")) {
        logError(
          `Unexpected argument: "${commandArgs[0]}". Run: dot init --help`,
        );
        ok = false;
      } else {
        ok = handleInit(parsed.configPath, commandArgs[0]);
      }
      break;
    case "add": {
      const addArgs = parseAddArgs(commandArgs);
      if (!addArgs.ok) {
        logError(addArgs.error);
        ok = false;
      } else {
        ok = handleAdd(addArgs.path, addArgs.name, parsed.configPath);
      }
      break;
    }
    case "version":
    case "-v":
    case "--version":
      console.log(VERSION);
      break;
    case "status": {
      ok = runWithConfiguration(handleStatus, parsed.configPath);
      break;
    }
    case "link":
    case "deploy":
    case "pull": {
      if (commandArgs.some((arg) => arg !== "--dry-run")) {
        logError(
          `Unexpected argument: "${commandArgs.find((arg) => arg !== "--dry-run")}". Run: dot ${command} --help`,
        );
        ok = false;
        break;
      }
      const dryRun = commandArgs.includes("--dry-run");
      const handler = {
        link: handleLink,
        deploy: handleDeploy,
        pull: handlePull,
      }[command];
      ok = runWithConfiguration(
        (config) => handler(config, dryRun),
        parsed.configPath,
      );
      break;
    }
    case "update": {
      const updateArgs = parseUpdateArgs(parsed.args);
      if (!updateArgs.ok) {
        logError(updateArgs.error);
        ok = false;
        break;
      }
      ok = runWithConfiguration(
        (config) =>
          handleUpdate(
            config,
            updateArgs.commitMessage,
            updateArgs.autoApprove,
            updateArgs.dryRun,
          ),
        parsed.configPath,
      );
      break;
    }
    case "help":
    case "-h":
    case "--help":
      if (commandArgs.length === 0) {
        printHelp();
      } else if (commandArgs.length > 1) {
        logError(
          `Unexpected argument: "${commandArgs[1]}". Run: dot help <command>`,
        );
        ok = false;
      } else if (!printCommandHelp(commandArgs[0].toLowerCase())) {
        logError(`Unknown command: "${commandArgs[0]}"`);
        ok = false;
      }
      break;
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
