import { spawnSync } from "child_process";
import {
  type Stats,
  lstatSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "fs";

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

type PreparedPathResult =
  | { ok: true; action: "none" }
  | {
      ok: true;
      action: "removed-link";
      target: string;
      linkType: "file" | "dir" | "junction";
    }
  | { ok: true; action: "created-backup"; backupPath: string }
  | { ok: false; action: "remove-link" | "create-backup"; error: string };

/** Converts an unknown caught value into a user-facing error message. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Safely retrieves the filesystem `lstat` stats for a given path.
 * Replaces the double-syscall existsSync + lstatSync pattern with a single try-catch check.
 *
 * @param path - The absolute file or directory path.
 * @returns The `Stats` object, or `null` if the path does not exist or is unreadable.
 */
export function safeLstat(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * Makes an existing filesystem path safe to replace.
 *
 * Symbolic links and Windows junction entries are unlinked without touching
 * their targets. Physical files/directories are moved to a timestamped backup.
 */
export function preparePathForReplacement(path: string): PreparedPathResult {
  const stat = safeLstat(path);
  if (!stat) return { ok: true, action: "none" };

  if (stat.isSymbolicLink()) {
    try {
      const target = readlinkSync(path);
      let linkType: "file" | "dir" | "junction" = "file";
      try {
        if (statSync(path).isDirectory())
          linkType = process.platform === "win32" ? "junction" : "dir";
      } catch {
        // A dangling link can still be replaced and its target retained for recovery.
      }
      // unlinkSync removes the link entry itself. On Windows, this is required
      // for junctions where recursive removal can fail or target real files.
      unlinkSync(path);
      return { ok: true, action: "removed-link", target, linkType };
    } catch (err) {
      return {
        ok: false,
        action: "remove-link",
        error: errorMessage(err),
      };
    }
  }

  const backupBase = `${path}_backup_${Date.now()}`;
  let backupPath = backupBase;
  let suffix = 0;
  while (safeLstat(backupPath)) backupPath = `${backupBase}_${++suffix}`;
  try {
    renameSync(path, backupPath);
    return { ok: true, action: "created-backup", backupPath };
  } catch (err) {
    return {
      ok: false,
      action: "create-backup",
      error: errorMessage(err),
    };
  }
}

/** Restores a replaced file, directory or link after failure, without overwriting a new destination. */
export function restorePreparedPath(
  path: string,
  prepared: Extract<PreparedPathResult, { ok: true }>,
): { ok: true } | { ok: false; error: string } {
  if (prepared.action === "none") return { ok: true };
  if (safeLstat(path))
    return { ok: false, error: `Recovery path already exists: ${path}` };
  try {
    if (prepared.action === "created-backup")
      renameSync(prepared.backupPath, path);
    else symlinkSync(prepared.target, path, prepared.linkType);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/**
 * Executes a system command synchronously and returns a structured result.
 *
 * @param args - The command name and arguments.
 * @param cwd - The working directory in which to execute the command.
 * @returns The command execution status, stdout, and stderr.
 */
export function runCmd(
  args: readonly [string, ...string[]],
  cwd?: string,
): CommandResult {
  const [command, ...commandArgs] = args;
  const proc = spawnSync(command, commandArgs, {
    cwd,
    env: process.env,
    encoding: "utf-8",
    windowsHide: true,
  });
  const stdout = typeof proc.stdout === "string" ? proc.stdout : "";
  const stderr = typeof proc.stderr === "string" ? proc.stderr : "";

  if (proc.error) {
    return {
      success: false,
      stdout,
      stderr:
        stderr || `Failed to run "${command}": ${errorMessage(proc.error)}`,
    };
  }

  return {
    success: proc.status === 0,
    stdout,
    stderr,
  };
}
