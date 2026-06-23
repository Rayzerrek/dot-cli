import { cpSync, mkdirSync } from "fs";
import { dirname } from "path";

import {
  errorMessage,
  preparePathForReplacement,
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

/**
 * Copies configured dotfiles from the repository into their system locations.
 *
 * Unlike `dot link`, this command materializes real files/directories at the
 * destination. Existing physical destinations are moved to timestamped backups;
 * existing symlink entries are removed without deleting their targets.
 */
export function handleDeploy({ links }: AppConfig): boolean {
  if (links.length === 0) return true;

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

    const preparedDestination = preparePathForReplacement(link.systemPath);
    if (!preparedDestination.ok) {
      const message =
        preparedDestination.action === "remove-link"
          ? "Failed to remove existing link"
          : "Failed to create backup";
      logError(`${message}: ${preparedDestination.error}`);
      ok = false;
      continue;
    }
    if (preparedDestination.action === "removed-link") {
      logInfo(`Removed existing link at ${link.systemPath} before copying.`);
    }
    if (preparedDestination.action === "created-backup") {
      logWarning(
        `Existing config detected at ${link.systemPath}. Created backup at: ${preparedDestination.backupPath}.`,
      );
      logSuccess("Backup created successfully!");
    }

    logInfo(`Copying '${link.repoPath}' to '${link.systemPath}'...`);
    try {
      mkdirSync(dirname(link.systemPath), { recursive: true });
      cpSync(link.repoPath, link.systemPath, {
        recursive: true,
        preserveTimestamps: true,
      });
      logSuccess(`Successfully deployed ${link.name}!`);
    } catch (err) {
      logError(`Error copying files: ${errorMessage(err)}`);
      ok = false;
    }
  }

  return ok;
}
