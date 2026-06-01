import {
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, resolve } from "path";

import { normalizePath } from "./paths.js";
import { errorMessage, safeLstat } from "./system.js";
import type { AppConfig, LinkCheckResult, ResolvedLink } from "./types.js";
import {
  bold,
  header,
  logError,
  logInfo,
  logSuccess,
  logWarning,
} from "./ui.js";

function resolveLinkTarget(linkPath: string, target: string): string {
  return isAbsolute(target) ? target : resolve(dirname(linkPath), target);
}

/**
 * Verifies whether a symbolic link or junction at the configured system path
 * points to the configured repository path.
 *
 * The function deliberately treats non-links as unhealthy instead of mutating
 * them. Repair and migration decisions are handled by {@link handleLink}.
 */
export function checkJunction(config: ResolvedLink): LinkCheckResult {
  const stat = safeLstat(config.systemPath);
  if (!stat) {
    return { linked: false, message: "Directory does not exist in system" };
  }
  if (!stat.isSymbolicLink()) {
    return {
      linked: false,
      message: "Physical directory exists, but is not a link",
    };
  }
  try {
    const target = readlinkSync(config.systemPath);
    if (
      normalizePath(resolveLinkTarget(config.systemPath, target)) ===
      normalizePath(config.repoPath)
    ) {
      return { linked: true, message: "Correct" };
    }
    return { linked: false, message: `Points to incorrect target: ${target}` };
  } catch (err) {
    return {
      linked: false,
      message: `Error reading link: ${errorMessage(err)}`,
    };
  }
}

/**
 * Generates platform-specific conventional system locations where a dotfile link might reside.
 *
 * The CLI is intentionally state-free and does not remember previous link
 * destinations. For cleanup, it probes conventional locations only. Custom
 * paths such as tool-specific AppData subfolders are not removed unless they
 * are current config entries processed by {@link handleLink}.
 */
function staleLinkCandidates(name: string): string[] {
  const home = homedir();
  const candidates = [join(home, name), join(home, ".config", name)];
  if (process.platform === "win32") {
    candidates.push(
      join(home, "AppData", "Local", name),
      join(home, "AppData", "Roaming", name),
    );
  }
  return candidates;
}

/**
 * Removes system links pointing to dotfile directories that have been removed
 * from the active config.
 *
 * Only symbolic links/junctions that still point into the dotfiles repository
 * are removed. Physical directories are never deleted here.
 */
function cleanStaleLinks({ dotfilesDir, links }: AppConfig): boolean {
  if (!safeLstat(dotfilesDir)) return true;

  let dotfileNames: string[];
  try {
    dotfileNames = readdirSync(dotfilesDir, { withFileTypes: true })
      // Skip git metadata; other dotfiles/directories are valid candidates
      .filter((entry) => entry.isDirectory() && entry.name !== ".git")
      .map((entry) => entry.name);
  } catch (err) {
    logWarning(
      `Could not scan dotfiles directory for stale links (${dotfilesDir}): ${errorMessage(err)}`,
    );
    return false;
  }

  const activeNames = new Set(links.map((link) => link.name));
  const staleNames = dotfileNames.filter((name) => !activeNames.has(name));
  if (staleNames.length === 0) return true;

  // Render the section header lazily to stay silent when there is nothing to clean up
  let printedHeader = false;
  const ensureHeader = () => {
    if (printedHeader) return;
    console.log(header("Cleaning Stale Links"));
    printedHeader = true;
  };

  let ok = true;
  for (const name of staleNames) {
    const repoPath = join(dotfilesDir, name);
    const normalizedRepoPath = normalizePath(repoPath);

    for (const candidate of staleLinkCandidates(name)) {
      const stat = safeLstat(candidate);
      if (!stat || !stat.isSymbolicLink()) continue;

      let target: string;
      try {
        target = readlinkSync(candidate);
      } catch (err) {
        ensureHeader();
        logWarning(
          `Could not read link target at ${candidate}: ${errorMessage(err)}`,
        );
        ok = false;
        continue;
      }

      if (normalizePath(resolveLinkTarget(candidate, target)) !== normalizedRepoPath) {
        continue;
      }

      try {
        // unlinkSync safely removes the link entry without risk of deleting target files.
        // On Windows, Bun's rmSync fails with EFAULT on junctions, so unlinkSync is required.
        unlinkSync(candidate);
        ensureHeader();
        logSuccess(`Removed stale link: ${candidate} → ${repoPath}`);
      } catch (err) {
        ensureHeader();
        logError(
          `Failed to remove stale link at ${candidate}: ${errorMessage(err)}`,
        );
        ok = false;
      }
    }
  }

  return ok;
}

/**
 * Restores configured dotfile links and migrates existing local directories
 * into the dotfiles repository when the repository copy is missing.
 *
 * Existing physical directories at target paths are moved to timestamped
 * backups before link creation. Existing incorrect symlinks/junctions are
 * removed. Target contents are never recursively deleted.
 */
export function handleLink(config: AppConfig): boolean {
  let ok = cleanStaleLinks(config);

  const { links } = config;
  if (links.length === 0) return ok;

  console.log(header("Restoring Dotfiles Links"));

  for (const link of links) {
    console.log(`\nProcessing ${bold(link.name)}...`);

    // Ensure source directory exists; migrate local system files if missing from repository
    if (!safeLstat(link.repoPath)) {
      const localStat = safeLstat(link.systemPath);
      if (!localStat || localStat.isSymbolicLink()) {
        logError(
          `Source directory does not exist in repository: ${link.repoPath}. Skipping.`,
        );
        ok = false;
        continue;
      }
      if (!localStat.isDirectory()) {
        logError(
          `Local configuration path is not a directory: ${link.systemPath}. Skipping.`,
        );
        ok = false;
        continue;
      }
      logInfo(
        `Moving local configuration from ${link.systemPath} to ${link.repoPath}...`,
      );
      try {
        mkdirSync(dirname(link.repoPath), { recursive: true });
        renameSync(link.systemPath, link.repoPath);
        logSuccess(`Successfully moved files to ${link.repoPath}!`);
      } catch (err) {
        logError(`Failed to move files: ${errorMessage(err)}`);
        ok = false;
        continue;
      }
    }

    if (checkJunction(link).linked) {
      logSuccess(`Link for ${link.name} is already correct. Skipping.`);
      continue;
    }

    // Handle existing target by creating a backup (if physical folder) or removing the invalid link
    const stat = safeLstat(link.systemPath);
    if (stat) {
      if (!stat.isSymbolicLink()) {
        const backupPath = `${link.systemPath}_backup_${Date.now()}`;
        logWarning(
          `Physical folder detected at ${link.systemPath}. Creating backup at: ${backupPath}...`,
        );
        try {
          renameSync(link.systemPath, backupPath);
          logSuccess(`Backup created successfully!`);
        } catch (err) {
          logError(`Failed to create backup: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      } else {
        logInfo(`Removing invalid or incorrect link at ${link.systemPath}...`);
        try {
          // unlinkSync is required for Windows/Bun junction support
          unlinkSync(link.systemPath);
        } catch (err) {
          logError(`Failed to remove old link: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      }
    }

    // Create new symbolic link or junction natively
    logInfo(`Creating link from '${link.systemPath}' to '${link.repoPath}'...`);
    try {
      mkdirSync(dirname(link.systemPath), { recursive: true });
      const type = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(link.repoPath, link.systemPath, type);
      logSuccess(`Successfully linked ${link.name}!`);
    } catch (err) {
      logError(`Error creating link: ${errorMessage(err)}`);
      ok = false;
    }
  }

  return ok;
}
