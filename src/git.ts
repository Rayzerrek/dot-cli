import { existsSync, realpathSync } from "fs";

import { sameFilesystemPath } from "./paths.js";

import { errorMessage, runCmd } from "./system.js";
import {
  bold,
  gray,
  header,
  logError,
  logInfo,
  logSuccess,
  logWarning,
  promptInput,
  yellow,
} from "./ui.js";

import type { AppConfig, ResolvedLink } from "./types.js";

interface GitChange {
  status: string;
  path: string;
}

function readRepositoryStatus(
  dotfilesDir: string,
):
  | { ok: true; changes: GitChange[]; branch: string }
  | { ok: false; error: string } {
  const result = runCmd(
    [
      "git",
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "--branch",
      "-z",
    ],
    dotfilesDir,
  );
  if (!result.success) return { ok: false, error: result.stderr };
  const records = result.stdout.split("\0");
  const branchRecord = records.shift();
  if (!branchRecord?.startsWith("## "))
    return { ok: false, error: "Unexpected Git branch status output" };
  const changes: GitChange[] = [];
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record === "" && i === records.length - 1) continue;
    if (!/^[ MADRCU?!T]{2} .+$/s.test(record))
      return { ok: false, error: "Unexpected Git file status output" };
    const status = record.slice(0, 2);
    changes.push({ status, path: record.slice(3) });
    if (status.includes("R") || status.includes("C")) {
      if (!records[i + 1])
        return { ok: false, error: "Missing Git rename source path" };
      i += 1;
    }
  }
  return { ok: true, changes, branch: branchRecord.slice(3) };
}

function displayGitChanges(changes: GitChange[]): void {
  for (const change of changes) {
    const path = /[\s\x00-\x1f\x7f]/.test(change.path)
      ? JSON.stringify(change.path)
      : change.path;
    console.log(`  ${gray(change.status)} ${path}`);
  }
}

function preflightGitRepository(
  dotfilesDir: string,
): { ok: true; branch: string } | { ok: false; error: string } {
  const git = (...args: string[]) => runCmd(["git", ...args], dotfilesDir);
  const root = git("rev-parse", "--show-toplevel");
  if (!root.success)
    return {
      ok: false,
      error: `Could not determine the repository root: ${root.stderr}`,
    };
  try {
    const canonicalRoot = realpathSync.native(root.stdout.trim());
    if (!sameFilesystemPath(canonicalRoot, realpathSync.native(dotfilesDir)))
      return {
        ok: false,
        error: `dotfilesDir must be the Git repository root: ${canonicalRoot}. Update your config before syncing.`,
      };
  } catch (error) {
    return {
      ok: false,
      error: `Could not resolve the repository root: ${errorMessage(error)}`,
    };
  }
  const branchRes = git("symbolic-ref", "--quiet", "--short", "HEAD");
  const branch = branchRes.stdout.trim();
  if (!branchRes.success || !branch)
    return {
      ok: false,
      error:
        "Cannot sync from a detached HEAD. Switch to a branch with: git switch <branch>",
    };
  const remote = git("remote", "get-url", "origin");
  if (!remote.success || !remote.stdout.trim())
    return {
      ok: false,
      error: `Remote origin is not configured. Run: git -C "${dotfilesDir}" remote add origin <url>`,
    };
  return { ok: true, branch };
}

/** Downloads dotfiles from origin with fast-forward only, preserving local changes. */
export function handlePull(
  { dotfilesDir }: AppConfig,
  dryRun: boolean = false,
): boolean {
  console.log(header("Pulling Dotfiles"));
  const status = readRepositoryStatus(dotfilesDir);
  if (!status.ok) {
    logError(`Failed to check git status: ${status.error}`);
    return false;
  }
  if (status.changes.length > 0) {
    displayGitChanges(status.changes);
    logError(
      "Local changes detected. Commit them with dot update or resolve them with Git before pulling.",
    );
    return false;
  }
  const repository = preflightGitRepository(dotfilesDir);
  if (!repository.ok) {
    logError(repository.error);
    return false;
  }
  const { branch } = repository;
  if (dryRun) {
    logInfo(
      `Would run: git pull --ff-only origin ${branch}. No remote has been contacted.`,
    );
    return true;
  }
  const result = runCmd(
    ["git", "pull", "--ff-only", "origin", branch],
    dotfilesDir,
  );
  if (!result.success) {
    logError(
      `Pull failed: ${result.stderr.trim()}. Only fast-forward updates are accepted; resolve any branch divergence with Git before retrying.`,
    );
    return false;
  }
  if (result.stdout.trim()) logInfo(result.stdout.trim());
  logSuccess(
    "Dotfiles pulled. Linked files are up to date; run dot deploy to refresh copies or dot link for new entries.",
  );
  return true;
}

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

  const gitStatus = readRepositoryStatus(dotfilesDir);
  if (!gitStatus.ok) {
    logError(
      `Failed to run git status: ${gitStatus.error.trim()}. If this is a new dotfiles folder, run: git -C "${dotfilesDir}" init`,
    );
    return false;
  }

  logInfo(`Branch: ${gitStatus.branch}`);
  if (gitStatus.changes.length > 0) {
    console.log(yellow("Uncommitted changes detected in repository:"));
    displayGitChanges(gitStatus.changes);
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
  autoApprove: boolean = false,
  dryRun: boolean = false,
): boolean {
  console.log(header("Updating Dotfiles"));

  if (!existsSync(dotfilesDir)) {
    logError(`Dotfiles repository directory does not exist at: ${dotfilesDir}`);
    return false;
  }

  const git = (...args: string[]) => runCmd(["git", ...args], dotfilesDir);

  logInfo("Checking changes in dotfiles...");
  const statusRes = readRepositoryStatus(dotfilesDir);
  if (!statusRes.ok) {
    logError(`Failed to check git status: ${statusRes.error}`);
    return false;
  }
  const { changes } = statusRes;
  if (
    changes.some((change) =>
      ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(change.status),
    )
  ) {
    logError(
      "Resolve merge conflicts before updating. Inspect them with: git status",
    );
    return false;
  }
  if (changes.length === 0) {
    if (statusRes.branch.startsWith("No commits yet on ")) {
      logSuccess("No changes to update.");
      return true;
    }
    const repository = preflightGitRepository(dotfilesDir);
    if (!repository.ok) {
      logError(repository.error);
      return false;
    }
    const remoteRef = `refs/remotes/origin/${repository.branch}`;
    const refs = git("for-each-ref", "--format=%(refname)", remoteRef);
    if (!refs.success) {
      logError(`Could not check the remote branch: ${refs.stderr}`);
      return false;
    }
    const hasRemoteBranch = refs.stdout.split(/\r?\n/).includes(remoteRef);
    const pending = hasRemoteBranch
      ? git("rev-list", "--count", "HEAD", `^${remoteRef}`)
      : git("rev-list", "--count", "HEAD");
    if (!pending.success || !/^\d+$/.test(pending.stdout.trim())) {
      logError(
        `Could not check unpushed commits: ${pending.stderr || "unexpected Git output"}`,
      );
      return false;
    }
    if (hasRemoteBranch && Number(pending.stdout.trim()) === 0) {
      logSuccess("No changes to update.");
      return true;
    }
    logInfo(
      `${pending.stdout.trim()} local commit(s) to push. No new commit will be created.`,
    );
  } else {
    console.log(`\n${bold("Detected changes to push:")}`);
    displayGitChanges(changes);
  }
  const lines = changes.map((change) => `${change.status} ${change.path}`);
  const finalMsg = commitMessage ?? buildCommitMessage(lines, links);
  if (changes.length > 0) logInfo(`Commit message: ${finalMsg}`);
  console.log("");

  if (dryRun) {
    logInfo(
      changes.length > 0
        ? "Would stage, commit, and push these changes to origin."
        : "Would push the existing local commits to origin.",
    );
    return true;
  }

  if (!autoApprove) {
    if (!process.stdin.isTTY) {
      logWarning(
        "Non-interactive terminal detected. To automatically commit and push, run with --yes or -y.",
      );
      logInfo("Update cancelled.");
      return false;
    }
    const answer = promptInput(
      changes.length > 0
        ? "Stage, commit, and push these changes? (y/N): "
        : "Push the existing local commits? (y/N): ",
    );
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      logInfo("Update cancelled by user.");
      return true;
    }
  }

  if (changes.length > 0) {
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
  }

  const repository = preflightGitRepository(dotfilesDir);
  if (!repository.ok) {
    logError(repository.error);
    return false;
  }
  const { branch } = repository;

  if (changes.length > 0) {
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
  }

  logInfo(`Pushing changes to remote (git push origin ${branch})...`);
  const pushRes = git("push", "origin", branch);
  if (pushRes.success) {
    logSuccess("Dotfiles successfully updated and pushed to origin!");
    return true;
  }

  logError(
    `Push failed; your commit is saved locally: ${pushRes.stderr.trim()}`,
  );
  logWarning(
    `Retry dot update --yes with the same config, or run: git -C "${dotfilesDir}" push origin ${branch}`,
  );
  return false;
}
