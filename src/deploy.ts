import { cpSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { dirname } from "path";

import { errorMessage, safeLstat } from "./system.js";
import type { AppConfig } from "./types.js";
import {
  bold,
  header,
  logError,
  logInfo,
  logSuccess,
  logWarning,
} from "./ui.js";

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
      logError(`Source does not exist in repository: ${link.repoPath}. Skipping.`);
      ok = false;
      continue;
    }

    const destinationStat = safeLstat(link.systemPath);
    if (destinationStat) {
      if (destinationStat.isSymbolicLink()) {
        logInfo(`Removing existing link at ${link.systemPath} before copying...`);
        try {
          unlinkSync(link.systemPath);
        } catch (err) {
          logError(`Failed to remove existing link: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      } else {
        const targetBackupPath = `${link.systemPath}_backup_${Date.now()}`;
        logWarning(
          `Existing config detected at ${link.systemPath}. Creating backup at: ${targetBackupPath}...`,
        );
        try {
          renameSync(link.systemPath, targetBackupPath);
          logSuccess("Backup created successfully!");
        } catch (err) {
          logError(`Failed to create backup: ${errorMessage(err)}`);
          ok = false;
          continue;
        }
      }
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
