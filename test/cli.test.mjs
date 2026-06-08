import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  createDirectorySymlinkOrSkip,
  createTempHome,
  runCli,
  skipWhenGitUnavailable,
  writeConfig,
} from "./support/helpers.mjs";

test("CLI help prints usage and exits successfully without loading config", (t) => {
  const { env } = createTempHome(t);
  const result = runCli(["help"], env);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dotfiles CLI Manager/);
  assert.match(result.stdout, /dot <command> \[options\]/);
  assert.match(result.stdout, /status/);
  assert.match(result.stdout, /version/);
  assert.doesNotMatch(result.stdout, /No configuration file found/);
});

test("CLI version prints the package version without loading config", (t) => {
  const { env } = createTempHome(t);
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf-8"),
  );
  assert.equal(typeof packageJson.version, "string");

  const result = runCli(["--version"], env);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, "");
});

test("CLI status succeeds when configured link points to the repository path", (t) => {
  if (skipWhenGitUnavailable(t)) {
    return;
  }

  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "nvim");
  const systemParent = join(root, "system");
  const systemPath = join(systemParent, "nvim");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(systemParent, { recursive: true });

  const gitInit = spawnSync("git", ["init"], {
    cwd: dotfilesDir,
    encoding: "utf-8",
  });
  assert.equal(gitInit.status, 0, gitInit.stderr);

  if (!createDirectorySymlinkOrSkip(t, repoPath, systemPath)) {
    return;
  }

  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "nvim", systemPath }] }),
  );

  const result = runCli(["status"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /nvim:/);
  assert.match(result.stdout, /Correct/);
  assert.match(result.stdout, /Git Repository Status/);
});

test("CLI link moves a local directory into the repository and replaces it with a link", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const systemPath = join(root, "system", "tool");
  mkdirSync(dotfilesDir, { recursive: true });
  mkdirSync(systemPath, { recursive: true });
  writeFileSync(join(systemPath, "settings.json"), "{}\n");

  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "tool", systemPath }] }),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(dotfilesDir, "tool", "settings.json"), "utf-8"),
    "{}\n",
  );
  assert.equal(lstatSync(systemPath).isSymbolicLink(), true);
  assert.equal(
    readdirSync(join(root, "system")).some((entry) =>
      entry.startsWith("tool_backup_"),
    ),
    false,
  );
  assert.match(result.stdout, /Successfully moved files/);
  assert.match(result.stdout, /Successfully linked tool/);
});

test("CLI link creates the system path parent directory before linking", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "tool");
  const systemPath = join(root, "missing-parent", "tool");
  mkdirSync(repoPath, { recursive: true });

  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "tool", systemPath }] }),
  );

  const result = runCli(["link"], env);

  if (
    result.status !== 0 &&
    /EPERM|EACCES|privilege|permission/i.test(result.stderr)
  ) {
    t.skip(
      `symlink creation is unavailable in this environment: ${result.stderr}`,
    );
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(systemPath).isSymbolicLink(), true);
  assert.match(result.stdout, /Successfully linked tool/);
});

test("CLI link uses repository-local config for freshly cloned dotfiles", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "tool");
  const systemPath = join(root, "system", "tool");
  mkdirSync(repoPath, { recursive: true });
  writeFileSync(
    join(dotfilesDir, "config.jsonc"),
    JSON.stringify({ links: [{ name: "tool", systemPath }] }),
  );

  const result = runCli(["link"], env);

  if (
    result.status !== 0 &&
    /EPERM|EACCES|privilege|permission/i.test(result.stderr)
  ) {
    t.skip(
      `symlink creation is unavailable in this environment: ${result.stderr}`,
    );
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(systemPath).isSymbolicLink(), true);
  assert.match(result.stdout, /Successfully linked tool/);
});

test("CLI link accepts an explicit config path for a non-default clone", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "my-dotfiles");
  const repoPath = join(dotfilesDir, "tool");
  const systemPath = join(root, "system", "tool");
  const configPath = join(dotfilesDir, "dot.config.jsonc");
  mkdirSync(repoPath, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({ links: [{ name: "tool", systemPath }] }),
  );

  const result = runCli(["link", "--config", configPath], env);

  if (
    result.status !== 0 &&
    /EPERM|EACCES|privilege|permission/i.test(result.stderr)
  ) {
    t.skip(
      `symlink creation is unavailable in this environment: ${result.stderr}`,
    );
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(systemPath).isSymbolicLink(), true);
  assert.match(result.stdout, /Successfully linked tool/);
});

test("CLI deploy uses repository-local config for freshly cloned dotfiles", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "nvim");
  const systemPath = join(root, ".config", "nvim");
  mkdirSync(repoPath, { recursive: true });
  writeFileSync(join(repoPath, "init.lua"), "vim.opt.number = true\n");
  writeFileSync(
    join(dotfilesDir, "config.jsonc"),
    JSON.stringify({ links: [{ name: "nvim", systemPath }] }),
  );

  const result = runCli(["deploy"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(systemPath).isDirectory(), true);
  assert.equal(lstatSync(systemPath).isSymbolicLink(), false);
  assert.equal(
    readFileSync(join(systemPath, "init.lua"), "utf-8"),
    "vim.opt.number = true\n",
  );
  assert.match(result.stdout, /Successfully deployed nvim/);
});

test("CLI deploy backs up an existing system config before copying", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "nvim");
  const systemParent = join(root, ".config");
  const systemPath = join(systemParent, "nvim");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(systemPath, { recursive: true });
  writeFileSync(join(repoPath, "init.lua"), "repo config\n");
  writeFileSync(join(systemPath, "init.lua"), "local config\n");
  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "nvim", systemPath }] }),
  );

  const result = runCli(["deploy"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readFileSync(join(systemPath, "init.lua"), "utf-8"),
    "repo config\n",
  );
  const backupName = readdirSync(systemParent).find((entry) =>
    entry.startsWith("nvim_backup_"),
  );
  assert.notEqual(backupName, undefined);
  assert.equal(
    readFileSync(join(systemParent, backupName, "init.lua"), "utf-8"),
    "local config\n",
  );
  assert.match(result.stdout, /Backup created successfully/);
  assert.match(result.stdout, /Successfully deployed nvim/);
});

test("CLI link fails when the config cannot be parsed", (t) => {
  const { root, env } = createTempHome(t);
  writeConfig(root, "{ invalid");

  const result = runCli(["link"], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Failed to parse config/);
  assert.doesNotMatch(result.stdout, /Restoring Dotfiles Links/);
});

test("CLI reports a missing explicit config path", (t) => {
  const { env } = createTempHome(t);

  const result = runCli(["link", "--config"], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--config requires a file path/);
  assert.doesNotMatch(result.stdout, /Restoring Dotfiles Links/);
});

test("CLI link rejects link names that escape the dotfiles directory", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  mkdirSync(dotfilesDir, { recursive: true });
  writeConfig(
    root,
    JSON.stringify({
      dotfilesDir,
      links: [{ name: "../outside", systemPath: join(root, "outside") }],
    }),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /links\[0\]\.name/);
});

test("CLI link rejects Windows reserved link names", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  mkdirSync(dotfilesDir, { recursive: true });
  writeConfig(
    root,
    JSON.stringify({
      dotfilesDir,
      links: [{ name: "CON", systemPath: join(root, "system", "CON") }],
    }),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /links\[0\]\.name/);
});

test("CLI link rejects circular repository and system paths", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, ".config", "nvim");
  mkdirSync(dotfilesDir, { recursive: true });
  writeConfig(
    root,
    JSON.stringify({
      dotfilesDir,
      links: [{ name: "nvim", systemPath: dotfilesDir }],
    }),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Circular link detected/);
});

test("CLI link falls back when an earlier config candidate is a directory", (t) => {
  const { root, env } = createTempHome(t);
  mkdirSync(join(root, ".config", "dot", "config.jsonc"), { recursive: true });
  writeFileSync(
    join(root, ".dotrc.json"),
    JSON.stringify({ dotfilesDir: join(root, "dotfiles"), links: [] }),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /Skipping config candidate because it is not a file/,
  );
});

test("CLI link accepts JSONC comments and does not print restore header for empty links", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  mkdirSync(dotfilesDir, { recursive: true });
  writeConfig(
    root,
    [
      "{",
      "  // URL-like strings must not be treated as comments.",
      `  "dotfilesDir": ${JSON.stringify(dotfilesDir)},`,
      '  "note": "https://example.test/path?q=//kept",',
      `  "escaped": ${JSON.stringify('quote: " and slash: \\')},`,
      '  "links": [],',
      "}",
      "",
    ].join("\n"),
  );

  const result = runCli(["link"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Restoring Dotfiles Links/);
});

test("CLI link cleans stale links without processing an empty link list", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const repoPath = join(dotfilesDir, "old");
  const staleParent = join(root, ".config");
  const stalePath = join(staleParent, "old");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(staleParent, { recursive: true });

  if (!createDirectorySymlinkOrSkip(t, repoPath, stalePath)) {
    return;
  }

  writeConfig(root, JSON.stringify({ dotfilesDir, links: [] }));

  const result = runCli(["link"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(stalePath), false);
  assert.match(result.stdout, /Cleaning Stale Links/);
  assert.doesNotMatch(result.stdout, /Restoring Dotfiles Links/);
});

test("CLI update fails clearly before commit when git identity is missing", (t) => {
  if (skipWhenGitUnavailable(t)) {
    return;
  }

  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  mkdirSync(dotfilesDir, { recursive: true });
  const gitInit = spawnSync("git", ["init"], {
    cwd: dotfilesDir,
    env,
    encoding: "utf-8",
  });
  assert.equal(gitInit.status, 0, gitInit.stderr);
  writeFileSync(join(dotfilesDir, "README.md"), "changed\n");
  writeConfig(root, JSON.stringify({ dotfilesDir, links: [] }));

  const result = runCli(["update"], {
    ...env,
    GIT_CONFIG_GLOBAL: join(root, "missing-global-gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git user\.email is not configured/);
  assert.doesNotMatch(result.stdout, /Staging changes/);
});
