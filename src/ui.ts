import { readSync, writeSync } from "fs";

const RESET = "\x1b[0m";
const wrap =
  (code: string, stream: NodeJS.WriteStream = process.stdout) =>
  (s: string) =>
    stream.isTTY && process.env.NO_COLOR === undefined
      ? `${code}${s}${RESET}`
      : s;

export const bold = wrap("\x1b[1m");
export const green = wrap("\x1b[32m");
export const red = wrap("\x1b[31m");
export const yellow = wrap("\x1b[33m");
export const cyan = wrap("\x1b[36m");
export const gray = wrap("\x1b[90m");
export const header = (title: string) => `\n${bold(title)}`;

const errorRed = wrap("\x1b[31m", process.stderr);
const errorBold = wrap("\x1b[1m", process.stderr);

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
  console.error(`${errorRed("✘")} ${errorBold("Error:")} ${msg}`);
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

const commandHelp = new Map<string, { usage: string; description: string }>([
  [
    "init",
    {
      usage: "dot init [repository] [-c <path>]",
      description:
        "Create a config without replacing existing files. Default: ~/.config/dot/config.jsonc. Use -c to create a portable repository config. Next: dot add <path>, then dot link.",
    },
  ],
  [
    "add",
    {
      usage: "dot add <path> [--name <name>] [-c <path>]",
      description:
        "Register a file or directory for this platform, preserving config comments. The name defaults to the path basename. This does not move files; run dot link afterwards. A missing default config is created automatically.",
    },
  ],
  [
    "status",
    {
      usage: "dot status [-c <path>]",
      description:
        "Check links, compare deployed copies, and show local Git changes. Exit code 1 means a path is missing, incorrect, changed, or a repository check failed.",
    },
  ],
  [
    "link",
    {
      usage: "dot link [--dry-run] [-c <path>]",
      description:
        "Create links to your dotfiles. Missing repository sources are moved from the system when available. Existing destination files and directories are backed up. Use --dry-run to preview all changes without writing files.",
    },
  ],
  [
    "deploy",
    {
      usage: "dot deploy [--dry-run] [-c <path>]",
      description:
        "Copy dotfiles to the system, skipping matching copies and backing up changed destinations. Copies are independent; later edits are not synced back. Use --dry-run to preview changes without writing files.",
    },
  ],
  [
    "pull",
    {
      usage: "dot pull [--dry-run] [-c <path>]",
      description:
        "Download updates from origin using fast-forward only. Refuses local changes and diverged branches. Linked files update immediately; run dot deploy to refresh copies or dot link for new entries. Use --dry-run to preview without contacting the remote.",
    },
  ],
  [
    "update",
    {
      usage: "dot update [message] [-y] [--dry-run] [-c <path>]",
      description:
        "Stage all repository changes, commit, and push to origin. Retries existing unpushed commits when no files changed. Shows the commit message before confirmation. Use -y / --yes to skip confirmation, --dry-run to preview, or -- before a message starting with a dash.",
    },
  ],
  [
    "version",
    {
      usage: "dot --version",
      description: "Print the installed version. Aliases: dot version, dot -v.",
    },
  ],
]);

/** Prints command help without loading configuration; returns false for unknown commands. */
export function printCommandHelp(command: string): boolean {
  if (["help", "-h", "--help"].includes(command)) {
    printHelp();
    return true;
  }
  const help = commandHelp.get(
    command === "-v" || command === "--version" ? "version" : command,
  );
  if (!help) return false;
  console.log(`\n${bold(help.usage)}\n\n${help.description}\n`);
  return true;
}

/**
 * Prints the command-line interface usage guide and available commands.
 */
export function printHelp(): void {
  console.log(`
${bold("Dotfiles CLI Manager")}

Your dotfiles, linked or copied across Windows, macOS, and Linux.

  dot <command> [options]

  ${green("init")}               Create your config
  ${green("add <path>")}         Register a file or directory
  ${green("link")}               Link configs; migrate local files when needed
  ${green("deploy")}             Copy configs instead of linking
  ${green("status")}             Check links and Git changes
  ${green("pull")}               Download repository updates (fast-forward only)
  ${green("update [message]")}   Commit and push repository changes

  -c, --config <path> Use a config file
  --dry-run          Preview link, deploy, pull, or update without changes
  -y, --yes           Skip update confirmation
  -v, --version       Print installed version
  -h, --help          Show help; also: dot <command> --help

Start: dot add <path> → dot link --dry-run → dot link → dot status
Details: dot help <command>
`);
}
