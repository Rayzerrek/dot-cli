import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "jsonc-parser";

import {
  createDirectorySymlinkOrSkip,
  createTempHome,
  runCli,
  skipWhenGitUnavailable,
  writeConfig,
} from "./support/helpers.mjs";

test("compact configs resolve relative paths from the config directory", (t) => {
  const { root, env } = createTempHome(t);
  const configDir = join(root, "portable");
  mkdirSync(join(configDir, "repo", "tool"), { recursive: true });
  const configPath = join(configDir, "config.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({ dotfilesDir: "repo", links: { tool: "../system/tool" } }),
  );

  const result = runCli(["deploy", "-c", configPath], env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(join(root, "system", "tool")).isDirectory(), true);
});

test("config validation reports line numbers and rejects empty or conflicting paths", (t) => {
  const { root, env } = createTempHome(t);
  writeConfig(root, '{\n  "links": invalid\n}\n');
  const invalid = runCli(["link"], env);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /line 2, column/);

  for (const links of [
    [{ name: "tool", systemPath: "" }],
    [
      { name: "tool", systemPath: join(root, "system") },
      { name: "other", systemPath: join(root, "system", "child") },
    ],
    [{ name: "tool", systemPath: join(root, "dotfiles", "other") }],
  ]) {
    writeConfig(
      root,
      JSON.stringify({ dotfilesDir: join(root, "dotfiles"), links }),
    );
    const result = runCli(["link"], env);
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(root, "dotfiles")), false);
  }
});

test("portable init and add preserve comments without moving the user's files", (t) => {
  const { root, env } = createTempHome(t);
  const configPath = join(root, "portable", "config.jsonc");
  const init = runCli(["init", "-c", configPath], env);
  assert.equal(init.status, 0, init.stderr);
  const initial = readFileSync(configPath, "utf-8");
  assert.match(initial, /Created by dot init/);
  assert.equal(parse(initial).dotfilesDir, undefined);
  const systemPath = join(root, "system", "tool");
  mkdirSync(systemPath, { recursive: true });
  writeFileSync(join(systemPath, "settings.json"), "original\n");

  const added = runCli(["add", systemPath, "-c", configPath], env);
  assert.equal(added.status, 0, added.stderr);
  const content = readFileSync(configPath, "utf-8");
  assert.match(content, /Created by dot init/);
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "macos"
        : "linux";
  assert.equal(parse(content).links.tool[platform], "~/system/tool");
  assert.equal(lstatSync(systemPath).isSymbolicLink(), false);
  assert.equal(
    readFileSync(join(systemPath, "settings.json"), "utf-8"),
    "original\n",
  );

  const repeated = runCli(["add", systemPath, "-c", configPath], env);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(readFileSync(configPath, "utf-8"), content);
});

test("add creates a default config and supports legacy arrays", (t) => {
  const { root, env } = createTempHome(t);
  const source = join(root, ".toolrc");
  writeFileSync(source, "config\n");
  const added = runCli(["add", source], env);
  assert.equal(added.status, 0, added.stderr);
  const configPath = join(root, ".config", "dot", "config.jsonc");
  assert.ok(parse(readFileSync(configPath, "utf8")).links[".toolrc"]);

  writeConfig(root, '{\n  // Keep this comment\n  "links": []\n}\n');
  const legacy = runCli(["add", source, "--name", "tool"], env);
  assert.equal(legacy.status, 0, legacy.stderr);
  const content = readFileSync(configPath, "utf8");
  assert.match(content, /Keep this comment/);
  assert.equal(parse(content).links[0].name, "tool");
});

test("dry runs preview migration, backups and stale cleanup without writing files", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const systemPath = join(root, "system", "tool");
  mkdirSync(systemPath, { recursive: true });
  writeFileSync(join(systemPath, "settings.json"), "local\n");
  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "tool", systemPath }] }),
  );
  const configDir = join(root, ".config", "dot");
  const before = readdirSync(configDir);
  const migration = runCli(["link", "--dry-run"], env);
  assert.equal(migration.status, 0, migration.stderr);
  assert.match(migration.stdout, /Would move/);
  assert.equal(existsSync(dotfilesDir), false);
  assert.equal(lstatSync(systemPath).isSymbolicLink(), false);
  assert.deepEqual(readdirSync(configDir), before);

  mkdirSync(join(dotfilesDir, "tool"), { recursive: true });
  writeFileSync(join(dotfilesDir, "tool", "settings.json"), "repo\n");
  for (const command of ["link", "deploy"]) {
    const result = runCli([command, "--dry-run"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Would back up/);
    assert.equal(
      readFileSync(join(systemPath, "settings.json"), "utf8"),
      "local\n",
    );
    assert.deepEqual(readdirSync(join(root, "system")), ["tool"]);
  }

  const stale = join(root, ".config", "old");
  mkdirSync(join(dotfilesDir, "old"));
  if (!createDirectorySymlinkOrSkip(t, join(dotfilesDir, "old"), stale)) return;
  const cleanup = runCli(["link", "--dry-run"], env);
  assert.equal(cleanup.status, 0, cleanup.stderr);
  assert.match(cleanup.stdout, /Would remove stale link/);
  assert.equal(lstatSync(stale).isSymbolicLink(), true);
});

test("status recognizes matching deployed copies and detects local edits", (t) => {
  if (skipWhenGitUnavailable(t)) return;
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const systemPath = join(root, "system", "tool");
  mkdirSync(join(dotfilesDir, "tool"), { recursive: true });
  writeFileSync(join(dotfilesDir, "tool", "settings.json"), "repo\n");
  assert.equal(spawnSync("git", ["init", dotfilesDir], { env }).status, 0);
  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "tool", systemPath }] }),
  );
  const deployed = runCli(["deploy"], env);
  assert.equal(deployed.status, 0, deployed.stderr);
  const status = runCli(["status"], env);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Copy matches repository/);
  assert.equal(existsSync(join(root, ".config", "dot", ".config-hash")), false);

  writeFileSync(join(systemPath, "settings.json"), "changed\n");
  const changed = runCli(["status"], env);
  assert.equal(changed.status, 1);
  assert.match(changed.stdout, /Copy differs from repository/);
});

test("deploy leaves an existing destination intact when copying cannot start", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const systemPath = join(root, "system", "tool");
  mkdirSync(dotfilesDir, { recursive: true });
  mkdirSync(systemPath, { recursive: true });
  writeFileSync(join(systemPath, "settings.json"), "preserved\n");
  const repoPath = join(dotfilesDir, "tool");
  try {
    symlinkSync(join(root, "missing-source"), repoPath, "file");
  } catch (error) {
    t.skip(`symlink creation is unavailable: ${String(error)}`);
    return;
  }
  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: [{ name: "tool", systemPath }] }),
  );
  const result = runCli(["deploy"], env);
  assert.equal(result.status, 1);
  assert.equal(
    readFileSync(join(systemPath, "settings.json"), "utf8"),
    "preserved\n",
  );
  assert.deepEqual(readdirSync(join(root, "system")), ["tool"]);
});

function gitRepository(t) {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  mkdirSync(dotfilesDir);
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: dotfilesDir,
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trimEnd();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Example");
  git("config", "user.email", "example@example.test");
  git("config", "commit.gpgsign", "false");
  writeConfig(root, JSON.stringify({ dotfilesDir, links: [] }));
  return { root, env, dotfilesDir, git };
}

test("update retries an unpushed commit after a failed push without making another commit", (t) => {
  if (skipWhenGitUnavailable(t)) return;
  const { root, env, dotfilesDir, git } = gitRepository(t);
  const remote = join(root, "remote.git");
  assert.equal(spawnSync("git", ["init", "--bare", remote], { env }).status, 0);
  git("remote", "add", "origin", remote);
  writeFileSync(join(dotfilesDir, "settings.json"), "first\n");
  const first = runCli(["update", "--yes"], env);
  assert.equal(first.status, 0, first.stderr);

  const branch = git("branch", "--show-current");
  git("remote", "set-url", "origin", join(root, "unavailable.git"));
  writeFileSync(join(dotfilesDir, "settings.json"), "second\n");
  const failed = runCli(["update", "--yes"], env);
  assert.equal(failed.status, 1);
  const commit = git("rev-parse", "HEAD");
  git("remote", "set-url", "origin", remote);
  const retried = runCli(["update", "--yes"], env);
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(git("rev-parse", "HEAD"), commit);
  const remoteCommit = spawnSync(
    "git",
    ["--git-dir", remote, "rev-parse", branch],
    { env, encoding: "utf8" },
  );
  assert.equal(remoteCommit.status, 0, remoteCommit.stderr);
  assert.equal(remoteCommit.stdout.trim(), commit);
});

test("update rejects a missing remote and detached HEAD before staging changes", (t) => {
  if (skipWhenGitUnavailable(t)) return;
  const { root, env, dotfilesDir, git } = gitRepository(t);
  writeFileSync(join(dotfilesDir, "settings.json"), "first\n");
  const missing = runCli(["update", "--yes"], env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /origin.*not configured/);
  assert.match(git("status", "--porcelain"), /^\?\? settings.json/);

  git("add", "-A");
  git("commit", "-m", "initial");
  git("checkout", "--detach");
  const remote = join(root, "remote.git");
  assert.equal(spawnSync("git", ["init", "--bare", remote], { env }).status, 0);
  git("remote", "add", "origin", remote);
  writeFileSync(join(dotfilesDir, "settings.json"), "second\n");
  const detached = runCli(["update", "--yes"], env);
  assert.equal(detached.status, 1);
  assert.match(detached.stderr, /detached HEAD/);
  assert.match(git("status", "--porcelain"), /^ M settings.json/);
});

test("update publishes a new branch even when its commits already exist on origin", (t) => {
  if (skipWhenGitUnavailable(t)) return;
  const { root, env, dotfilesDir, git } = gitRepository(t);
  const remote = join(root, "remote.git");
  assert.equal(spawnSync("git", ["init", "--bare", remote], { env }).status, 0);
  git("remote", "add", "origin", remote);
  writeFileSync(join(dotfilesDir, "settings"), "initial\n");
  assert.equal(runCli(["update", "--yes"], env).status, 0);
  const commit = git("rev-parse", "HEAD");
  git("checkout", "-b", "laptop");
  const published = runCli(["update", "--yes"], env);
  assert.equal(published.status, 0, published.stderr);
  const remoteCommit = spawnSync(
    "git",
    ["--git-dir", remote, "rev-parse", "laptop"],
    { env, encoding: "utf8" },
  );
  assert.equal(remoteCommit.status, 0, remoteCommit.stderr);
  assert.equal(remoteCommit.stdout.trim(), commit);
  assert.equal(git("rev-parse", "HEAD"), commit);
});

test("update accepts Windows short path aliases for the repository", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows short paths do not apply on this platform");
    return;
  }
  if (skipWhenGitUnavailable(t)) return;
  const { root, env, dotfilesDir, git } = gitRepository(t);
  const alias = spawnSync(
    "cmd.exe",
    ["/d", "/c", 'for %I in ("%DOT_TEST_REPO%") do @echo %~fsI'],
    {
      env: { ...env, DOT_TEST_REPO: dotfilesDir },
      encoding: "utf8",
      windowsVerbatimArguments: true,
    },
  );
  assert.equal(alias.status, 0, alias.stderr);
  const shortPath = alias.stdout.trim();
  assert.ok(shortPath && !shortPath.includes('"'), shortPath);
  if (shortPath.toLowerCase() === dotfilesDir.toLowerCase()) {
    t.skip("Short path aliases are unavailable on this volume");
    return;
  }
  const remote = join(root, "remote.git");
  assert.equal(spawnSync("git", ["init", "--bare", remote], { env }).status, 0);
  git("remote", "add", "origin", remote);
  writeFileSync(join(dotfilesDir, "settings"), "initial\n");
  writeConfig(root, JSON.stringify({ dotfilesDir: shortPath, links: [] }));
  const updated = runCli(["update", "--yes"], env);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(git("rev-list", "--count", "HEAD"), "1");
});

test("update dry run shows the planned message without staging, committing or pushing", (t) => {
  if (skipWhenGitUnavailable(t)) return;
  const { root, env, dotfilesDir, git } = gitRepository(t);
  const name = "zażółć config";
  mkdirSync(join(dotfilesDir, name));
  writeFileSync(join(dotfilesDir, name, "settings.json"), "first\n");
  writeConfig(
    root,
    JSON.stringify({
      dotfilesDir,
      links: [{ name, systemPath: join(root, "system", name) }],
    }),
  );
  const preview = runCli(["update", "--dry-run"], env);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /update: zażółć config config/);
  assert.match(git("status", "--porcelain", "-z"), /^\?\?/);
  assert.equal(
    spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: dotfilesDir,
      env,
    }).status,
    128,
  );
});

test("project config is discovered from the working directory", (t) => {
  const { root, env } = createTempHome(t);
  const project = join(root, "project");
  mkdirSync(join(project, "tool"), { recursive: true });
  writeFileSync(join(project, "tool", "settings"), "portable\n");
  writeFileSync(
    join(project, "dot.config.jsonc"),
    JSON.stringify({ links: { tool: "../system/tool" } }),
  );
  writeConfig(root, "{ invalid global config");
  const deployed = runCli(["deploy"], env, project);
  assert.equal(deployed.status, 0, deployed.stderr);
  assert.equal(
    readFileSync(join(root, "system", "tool", "settings"), "utf8"),
    "portable\n",
  );
});

test("repeated deploy is a no-op and same-length file edits are detected", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  const systemPath = join(root, "system", "tool");
  mkdirSync(join(dotfilesDir, "tool"), { recursive: true });
  writeFileSync(join(dotfilesDir, "tool", "settings"), "aaaa\n");
  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: { tool: systemPath } }),
  );
  assert.equal(runCli(["deploy"], env).status, 0);
  const before = lstatSync(join(systemPath, "settings"));
  const repeated = runCli(["deploy"], env);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.match(repeated.stdout, /already current/);
  assert.equal(lstatSync(join(systemPath, "settings")).mtimeMs, before.mtimeMs);
  assert.deepEqual(readdirSync(join(root, "system")), ["tool"]);

  writeFileSync(join(systemPath, "settings"), "bbbb\n");
  const replaced = runCli(["deploy"], env);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(readFileSync(join(systemPath, "settings"), "utf8"), "aaaa\n");
  const backup = readdirSync(join(root, "system")).find((entry) =>
    entry.startsWith("tool_backup_"),
  );
  assert.ok(backup);
  assert.equal(
    readFileSync(join(root, "system", backup, "settings"), "utf8"),
    "bbbb\n",
  );
});

test("deploy refreshes POSIX file and directory permissions when contents match", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX permissions do not apply on Windows");
    return;
  }
  const { root, env } = createTempHome(t);
  const source = join(root, "dotfiles", "tool");
  const destination = join(root, "system", "tool");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "script.sh"), "#!/bin/sh\necho example\n", {
    mode: 0o644,
  });
  writeConfig(root, JSON.stringify({ links: { tool: destination } }));
  assert.equal(runCli(["deploy"], env).status, 0);
  chmodSync(join(source, "script.sh"), 0o755);
  const executable = runCli(["deploy"], env);
  assert.equal(executable.status, 0, executable.stderr);
  assert.equal(statSync(join(destination, "script.sh")).mode & 0o777, 0o755);
  chmodSync(source, 0o700);
  const privateDirectory = runCli(["deploy"], env);
  assert.equal(privateDirectory.status, 0, privateDirectory.stderr);
  assert.equal(statSync(destination).mode & 0o777, 0o700);
  mkdirSync(join(source, "private"), { mode: 0o700 });
  const privateNestedDirectory = runCli(["deploy"], env);
  assert.equal(privateNestedDirectory.status, 0, privateNestedDirectory.stderr);
  assert.equal(statSync(join(destination, "private")).mode & 0o777, 0o700);
});

test("symlink aliases cannot place a system destination inside the repository", (t) => {
  const { root, env } = createTempHome(t);
  const dotfilesDir = join(root, "dotfiles");
  mkdirSync(join(dotfilesDir, "tool"), { recursive: true });
  const alias = join(root, "alias");
  if (!createDirectorySymlinkOrSkip(t, dotfilesDir, alias)) return;
  writeConfig(
    root,
    JSON.stringify({ dotfilesDir, links: { tool: join(alias, "other") } }),
  );
  const result = runCli(["link", "--dry-run"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Circular link/);
  assert.equal(existsSync(join(dotfilesDir, "other")), false);
});

test("config rejects destinations that overlap through a directory alias", (t) => {
  const { root, env } = createTempHome(t);
  const system = join(root, "system");
  mkdirSync(system);
  mkdirSync(join(root, "dotfiles", "first"), { recursive: true });
  mkdirSync(join(root, "dotfiles", "second"));
  const alias = join(root, "system-alias");
  if (!createDirectorySymlinkOrSkip(t, system, alias)) return;
  writeConfig(
    root,
    JSON.stringify({
      links: { first: join(system, "tool"), second: join(alias, "tool") },
    }),
  );
  const result = runCli(["link", "--dry-run"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Overlapping system paths/);
  assert.equal(existsSync(join(system, "tool")), false);
});

test("add preserves platform mappings in compact and legacy configs", (t) => {
  const { root, env } = createTempHome(t);
  const source = join(root, "tool");
  mkdirSync(source);
  const otherPlatform = process.platform === "win32" ? "linux" : "windows";
  const mappings = { [otherPlatform]: "~/other-tool" };
  for (const links of [
    { tool: mappings },
    [{ name: "tool", systemPath: mappings }],
  ]) {
    writeConfig(root, JSON.stringify({ links }));
    const result = runCli(["add", source], env);
    assert.equal(result.status, 0, result.stderr);
    const parsed = parse(
      readFileSync(join(root, ".config", "dot", "config.jsonc"), "utf8"),
    );
    const updated = Array.isArray(parsed.links)
      ? parsed.links[0].systemPath
      : parsed.links.tool;
    assert.equal(updated[otherPlatform], "~/other-tool");
    assert.equal(Object.keys(updated).length, 2);
  }
});

test("update refuses unresolved conflicts instead of staging conflict markers", (t) => {
  if (skipWhenGitUnavailable(t)) return;
  const { env, dotfilesDir, git } = gitRepository(t);
  const configFile = join(dotfilesDir, "settings.json");
  writeFileSync(configFile, "initial\n");
  git("add", "-A");
  git("commit", "-m", "initial");
  git("checkout", "-b", "other");
  writeFileSync(configFile, "other\n");
  git("commit", "-am", "other");
  git("checkout", "main");
  writeFileSync(configFile, "main\n");
  git("commit", "-am", "main");
  assert.equal(
    spawnSync("git", ["merge", "other"], { cwd: dotfilesDir, env }).status,
    1,
  );
  const before = git("status", "--porcelain");
  const result = runCli(["update", "--yes"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Resolve merge conflicts/);
  assert.equal(git("status", "--porcelain"), before);
});

test("pull previews and fast-forwards a second machine without overwriting local edits", (t) => {
  if (skipWhenGitUnavailable(t)) return;
  const { root, env, dotfilesDir, git } = gitRepository(t);
  const remote = join(root, "remote.git");
  assert.equal(spawnSync("git", ["init", "--bare", remote], { env }).status, 0);
  git("remote", "add", "origin", remote);
  writeFileSync(join(dotfilesDir, "settings"), "first\n");
  const first = runCli(["update", "--yes"], env);
  assert.equal(first.status, 0, first.stderr);
  const machine = join(root, "second-machine");
  assert.equal(
    spawnSync(
      "git",
      [
        "clone",
        "--config",
        "core.autocrlf=false",
        "--branch",
        "main",
        remote,
        machine,
      ],
      { env },
    ).status,
    0,
  );
  writeFileSync(join(dotfilesDir, "settings"), "second\n");
  assert.equal(runCli(["update", "--yes"], env).status, 0);
  const configPath = join(root, "second.config.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({ dotfilesDir: machine, links: [] }),
  );

  const preview = runCli(["pull", "--dry-run", "-c", configPath], env);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(readFileSync(join(machine, "settings"), "utf8"), "first\n");
  const pulled = runCli(["pull", "-c", configPath], env);
  assert.equal(pulled.status, 0, pulled.stderr);
  assert.equal(readFileSync(join(machine, "settings"), "utf8"), "second\n");

  writeFileSync(join(machine, "settings"), "local edit\n");
  const refused = runCli(["pull", "-c", configPath], env);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Local changes/);
  assert.equal(readFileSync(join(machine, "settings"), "utf8"), "local edit\n");
});
