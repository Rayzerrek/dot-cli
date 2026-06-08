import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

import { buildInitialConfigContent } from "../dist/config.js";
import { buildCommitMessage } from "../dist/git.js";
import { checkJunction } from "../dist/links.js";
import { normalizePath } from "../dist/paths.js";
import { runCmd } from "../dist/system.js";
import {
  createDirectorySymlinkOrSkip,
  createTempDir,
} from "./support/helpers.mjs";

test("buildInitialConfigContent writes documented JSONC starter config", () => {
  const content = buildInitialConfigContent("~/dotfiles");

  assert.match(content, /Created by dot init/);
  assert.match(content, /"dotfilesDir": "~\/dotfiles"/);
  assert.match(content, /"links": \[\]/);
  assert.equal(content.endsWith("\n"), true);
});

test("buildCommitMessage groups porcelain paths by configured link name", () => {
  const message = buildCommitMessage(
    [" M nvim/init.lua", "?? .agents/skills/example.md", " A README.md"],
    [
      { name: "nvim", repoPath: "/repo/nvim", systemPath: "/system/nvim" },
      {
        name: ".agents",
        repoPath: "/repo/.agents",
        systemPath: "/system/.agents",
      },
    ],
  );

  assert.match(
    message,
    /^update: nvim, \.agents, general config \(\d{4}-\d{2}-\d{2}\)$/,
  );
});

test("buildCommitMessage matches complete top-level path segments", () => {
  const message = buildCommitMessage(
    [" M nvim-extra/init.lua", " M nvim/init.lua"],
    [{ name: "nvim", repoPath: "/repo/nvim", systemPath: "/system/nvim" }],
  );

  assert.match(message, /^update: general, nvim config \(\d{4}-\d{2}-\d{2}\)$/);
});

test("normalizePath expands a home-directory path to an absolute path", () => {
  assert.equal(
    normalizePath("~/dotfiles"),
    resolve(join(homedir(), "dotfiles")),
  );
});

test("runCmd returns raw structured output for successful and failing commands", () => {
  const success = runCmd([process.execPath, "-e", "console.log('ok')"]);
  assert.equal(success.success, true);
  assert.equal(success.stdout, "ok\n");
  assert.equal(success.stderr, "");

  const failure = runCmd([process.execPath, "-e", "process.exit(7)"]);
  assert.equal(failure.success, false);
});

test("runCmd reports spawn errors for missing commands", () => {
  const result = runCmd(["dot-cli-command-that-should-not-exist"]);

  assert.equal(result.success, false);
  assert.match(
    result.stderr,
    /dot-cli-command-that-should-not-exist|ENOENT|not found/i,
  );
});

test("checkJunction reports missing and physical paths as unhealthy", (t) => {
  const root = createTempDir(t, "dot-cli-unit-");
  const repoPath = join(root, "repo", "nvim");
  const systemPath = join(root, "system", "nvim");
  mkdirSync(repoPath, { recursive: true });

  assert.deepEqual(checkJunction({ name: "nvim", repoPath, systemPath }), {
    linked: false,
    message: "Directory does not exist in system",
  });

  mkdirSync(systemPath, { recursive: true });
  assert.deepEqual(checkJunction({ name: "nvim", repoPath, systemPath }), {
    linked: false,
    message: "Physical directory exists, but is not a link",
  });
});

test("checkJunction accepts a link pointing at the configured repository path", (t) => {
  const root = createTempDir(t, "dot-cli-unit-");
  const repoPath = join(root, "repo", "nvim");
  const systemParent = join(root, "system");
  const systemPath = join(systemParent, "nvim");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(systemParent, { recursive: true });

  if (!createDirectorySymlinkOrSkip(t, repoPath, systemPath)) {
    return;
  }

  assert.deepEqual(checkJunction({ name: "nvim", repoPath, systemPath }), {
    linked: true,
    message: "Correct",
  });
});

test("checkJunction resolves relative link targets from the link location", (t) => {
  if (process.platform === "win32") {
    t.skip("relative directory symlink behavior differs for Windows junctions");
    return;
  }

  const root = createTempDir(t, "dot-cli-unit-");
  const repoPath = join(root, "repo", "nvim");
  const systemParent = join(root, "system");
  const systemPath = join(systemParent, "nvim");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(systemParent, { recursive: true });

  symlinkSync(relative(systemParent, repoPath), systemPath, "dir");

  assert.deepEqual(checkJunction({ name: "nvim", repoPath, systemPath }), {
    linked: true,
    message: "Correct",
  });
});
