import { readSync, writeSync } from "fs";

// ANSI color helpers - small wrappers to keep call sites concise
const RESET = "\x1b[0m";
const wrap = (code: string) => (s: string) => `${code}${s}${RESET}`;

export const bold = wrap("\x1b[1m");
export const green = wrap("\x1b[32m");
export const red = wrap("\x1b[31m");
export const yellow = wrap("\x1b[33m");
export const cyan = wrap("\x1b[36m");
export const gray = wrap("\x1b[90m");
export const header = (title: string) => `\n${bold(`--- ${title} ---`)}`;

export function logInfo(msg: string): void {
  console.log(`${cyan("ℹ")} ${msg}`);
}

export function logSuccess(msg: string): void {
  console.log(`${green("✔")} ${msg}`);
}

export function logWarning(msg: string): void {
  console.log(`${yellow("⚠")} ${msg}`);
}

export function logError(msg: string): void {
  console.error(`${red("✘")} ${bold("Error:")} ${msg}`);
}

/**
 * Prompts for a single line of terminal input using synchronous file-descriptor
 * operations so command handlers can remain simple and deterministic.
 */
export function promptInput(question: string): string {
  writeSync(process.stdout.fd, question);
  if (!process.stdin.isTTY) {
    logWarning("Input is not a TTY; using the default value.");
    return "";
  }
  const buffer = Buffer.alloc(1024);
  const bytesRead = readSync(process.stdin.fd, buffer, 0, buffer.length, null);
  return buffer.toString("utf-8", 0, bytesRead).trim();
}

/**
 * Prints the command-line interface usage guide and available commands.
 */
export function printHelp(): void {
  console.log(`
${cyan(bold("Dotfiles CLI Manager"))}

A lightweight CLI manager to keep system configurations (dotfiles) in sync.

${bold("USAGE:")}
  dot <command> [options]

${bold("COMMANDS:")}
  ${green("init")}               Create the default configuration file.
  ${green("version")}            Display the installed dot-cli version.
  ${green("update [message]")}  Stage, commit, and push dotfiles changes to GitHub.
                          If no commit message is provided, one will be auto-generated.
  ${green("status")}             Check the state of system links and the git repository.
  ${green("link")}               Restore or recreate missing system links dynamically.
  ${green("help")}               Display this help message.
`);
}
