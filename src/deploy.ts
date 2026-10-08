import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "fs";
import { basename, dirname, join } from "path";

import { compareDotfileCopies } from "./copy-status.js";
import {
  errorMessage,
  preparePathForReplacement,
  restorePreparedPath,
  safeLstat,
} from "./system.js";
import {
  bold,
  header,
  logError,
  logInfo,
  logSuccess,
  logWarning,
} from "./ui.js";

import type { AppConfig } from "./types.js";

function preserveDirectoryPermissions(
  source: string,
  destination: string,
): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory())
      preserveDirectoryPermissions(
        join(source, entry.name),
        join(destination, entry.name),
      );
  }
  // cpSync preserves file modes, but creates directories with default permissions.
  chmodSync(destination, lstatSync(source).mode & 0o777);
}

/**
 * Copies configured dotfiles from the repository into their system locations.
 *
 * Unlike `dot link`, this command materializes real files/directories at the
 * destination. Existing physical destinations are moved to timestamped backups;
 * existing symlink entries are removed without deleting their targets.
 */
export function handleDeploy({ links }: AppConfig, dryRun = false): boolean {
  if (dryRun) logInfo("Dry run: no files will be changed.");
  if (links.length === 0) {
    logInfo(
      "No links configured for this platform. Add entries to links in your config.",
    );
    return true;
  }

  console.log(header("Deploying Dotfiles"));

  let ok = true;
  for (const link of links) {
    console.log(`\nProcessing ${bold(link.name)}...`);

    const sourceStat = safeLstat(link.repoPath);
    if (!sourceStat) {
      logError(
        `Source does not exist in repository: ${link.repoPath}. Skipping.`,
      );
      ok = false;
      continue;
    }
    if (!sourceStat.isDirectory() && !sourceStat.isFile()) {
      logError(
        `Repository source is not a regular file or directory: ${link.repoPath}. Skipping.`,
      );
      ok = false;
      continue;
    }
    const destinationStat = safeLstat(link.systemPath);
    if (destinationStat && !destinationStat.isSymbolicLink()) {
      const copy = compareDotfileCopies(link.repoPath, link.systemPath);
      if (!copy.ok) {
        logError(`Could not compare ${link.name}: ${copy.error}`);
        ok = false;
        continue;
      }
      if (copy.matches) {
        logSuccess(`Copy for ${link.name} is already current. Skipping.`);
        continue;
      }
    }
    if (dryRun) {
      const destination = safeLstat(link.systemPath);
      if (destination)
        logInfo(
          `Would ${destination.isSymbolicLink() ? "replace link" : "back up"}: ${link.systemPath}`,
        );
      logInfo(`Would copy ${link.repoPath} to ${link.systemPath}`);
      continue;
    }

    logInfo(`Copying '${link.repoPath}' to '${link.systemPath}'...`);
    let stagingDirectory: string | undefined;
    try {
      mkdirSync(dirname(link.systemPath), { recursive: true });
      stagingDirectory = mkdtempSync(
        join(dirname(link.systemPath), ".dot-deploy-"),
      );
      const stagedPath = join(stagingDirectory, "config");
      cpSync(link.repoPath, stagedPath, {
        recursive: true,
        preserveTimestamps: true,
      });
      if (process.platform !== "win32" && sourceStat.isDirectory())
        preserveDirectoryPermissions(link.repoPath, stagedPath);
      const preparedDestination = preparePathForReplacement(link.systemPath);
      if (!preparedDestination.ok) {
        logError(`Failed to prepare destination: ${preparedDestination.error}`);
        ok = false;
        continue;
      }
      if (preparedDestination.action === "created-backup") {
        logSuccess(
          `Backup created successfully: ${preparedDestination.backupPath}`,
        );
      }
      try {
        renameSync(stagedPath, link.systemPath);
      } catch (err) {
        const restored = restorePreparedPath(
          link.systemPath,
          preparedDestination,
        );
        if (!restored.ok)
          logError(
            `Could not restore the previous destination: ${restored.error}`,
          );
        throw err;
      }
      logSuccess(`Successfully deployed ${link.name}!`);
    } catch (err) {
      logError(`Error copying files: ${errorMessage(err)}`);
      ok = false;
    } finally {
      if (stagingDirectory) {
        try {
          if (
            dirname(stagingDirectory) !== dirname(link.systemPath) ||
            !basename(stagingDirectory).startsWith(".dot-deploy-")
          ) {
            throw new Error(
              `Unexpected temporary copy path: ${stagingDirectory}`,
            );
          }
          rmSync(stagingDirectory, { recursive: true, force: true });
        } catch (err) {
          logWarning(
            `Could not remove temporary copy at ${stagingDirectory}: ${errorMessage(err)}`,
          );
          ok = false;
        }
      }
    }
  }

  return ok;
}
