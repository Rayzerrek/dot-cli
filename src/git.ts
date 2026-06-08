import { existsSync } from "fs";

import { runCmd } from "./system.js";
import {
  bold,
  gray,
  header,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  red,
  yellow,
} from "./ui.js";

import type { AppConfig, ResolvedLink } from "./types.js";

/**
 * Prints the short git status for the configured dotfiles repository.
 *
 * This is intentionally read-only. Mutating git workflows live in
 * {@link handleUpdate}.
 */
export function printGitRepositoryStatus(dotfilesDir: string): boolean {
  if (!existsSync(dotfilesDir)) {
    logError(`Dotfiles repository directory does not exist at: ${dotfilesDir}`);
    return false;
  }

  const gitStatus = runCmd(["git", "status", "-s"], dotfilesDir);
  if (!gitStatus.success) {
    logError(`Failed to run git status: ${gitStatus.stderr}`);
    return false;
  }

  const statusText = gitStatus.stdout.trimEnd();
  if (statusText) {
    console.log(yellow("Uncommitted changes detected in repository:"));
    for (const line of statusText.split(/\r?\n/)) {
      console.log(`  ${line}`);
    }
  } else {
    logSuccess("Dotfiles repository is clean (nothing to commit).");
  }

  return true;
}

/**
 * Builds the default commit message for a dotfiles update.
 *
 * Git porcelain paths are grouped by configured link names when possible, with
 * unmatched files grouped under `general`. This keeps automatic commits useful
 * without requiring the CLI to understand the full repository layout.
 */
export function buildCommitMessage(
  statusLines: string[],
  links: ResolvedLink[],
): string {
  const configuredLinkNames = new Set(links.map((link) => link.name));
  const changedConfigs = new Set<string>();

  for (const line of statusLines) {
    const file = line.slice(3).replace(/\\/g, "/");
    const [topLevelName] = file.split("/", 1);
    changedConfigs.add(
      configuredLinkNames.has(topLevelName) ? topLevelName : "general",
    );
  }

  const dateStr = new Date().toISOString().split("T")[0];
  return `update: ${[...changedConfigs].join(", ")} config (${dateStr})`;
}

/**
 * Stages, commits, and pushes current changes from the dotfiles repository.
 *
 * If no commit message is provided, one is generated from porcelain status
 * lines using {@link buildCommitMessage}. A successful no-op status is treated
 * as success.
 */
export function handleUpdate(
  { dotfilesDir, links }: AppConfig,
  commitMessage?: string,
): boolean {
  console.log(header("Updating Dotfiles"));

  if (!existsSync(dotfilesDir)) {
    logError(`Dotfiles repository directory does not exist at: ${dotfilesDir}`);
    return false;
  }

  const git = (...args: string[]) => runCmd(["git", ...args], dotfilesDir);

  logInfo("Checking changes in dotfiles...");
  const statusRes = git("status", "--porcelain");
  if (!statusRes.success) {
    logError(`Failed to check git status: ${statusRes.stderr}`);
    return false;
  }
  const statusText = statusRes.stdout.trimEnd();
  if (!statusText) {
    logSuccess("No changes to update.");
    return true;
  }

  const emailRes = git("config", "user.email");
  if (!emailRes.success || !emailRes.stdout.trim()) {
    logError(
      'Git user.email is not configured. Run: git config --global user.email "you@example.com"',
    );
    return false;
  }

  const nameRes = git("config", "user.name");
  if (!nameRes.success || !nameRes.stdout.trim()) {
    logError(
      'Git user.name is not configured. Run: git config --global user.name "Your Name"',
    );
    return false;
  }

  const lines = statusText.split(/\r?\n/);

  // Display changes to be pushed
  console.log(`\n${bold("Detected changes to push:")}`);
  for (const line of lines) {
    console.log(`  ${gray(line)}`);
  }
  console.log("");

  // Prepare commit message
  const finalMsg = commitMessage ?? buildCommitMessage(lines, links);

  logInfo("Staging changes (git add)...");
  const addRes = git("add", "-A");
  if (!addRes.success) {
    logError(`Failed to stage changes: ${addRes.stderr}`);
    return false;
  }

  logInfo(`Creating commit: "${finalMsg}"...`);
  const commitRes = git("commit", "-m", finalMsg);
  if (!commitRes.success) {
    logError(`Failed to create commit: ${commitRes.stderr}`);
    return false;
  }
  logSuccess("Commit created successfully!");

  const branchRes = git("branch", "--show-current");
  const branch = branchRes.stdout.trim();
  if (!branchRes.success || !branch) {
    logError(
      `Could not determine current branch: ${branchRes.stderr.trim() || "empty result"}`,
    );
    logWarning(
      `Commit was created locally. Push manually with: git -C "${dotfilesDir}" push origin <branch>`,
    );
    return false;
  }

  logInfo(`Pushing changes to remote (git push origin ${branch})...`);
  const pushRes = git("push", "origin", branch);
  if (pushRes.success) {
    logSuccess("Dotfiles successfully updated and pushed to GitHub!");
    return true;
  }

  logWarning(
    "Changes committed locally, but failed to push to remote repository:",
  );
  console.log(`  ${red(pushRes.stderr)}`);
  logWarning(
    `You can try to push manually later using: git -C "${dotfilesDir}" push origin ${branch}`,
  );
  return false;
}
