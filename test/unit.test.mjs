import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

import { buildInitialConfigContent } from "../dist/config.js";
import { compareDotfileCopies } from "../dist/copy-status.js";
import { buildCommitMessage } from "../dist/git.js";
import { checkJunction } from "../dist/links.js";
import { normalizePath } from "../dist/paths.js";
import {
  preparePathForReplacement,
  restorePreparedPath,
  runCmd,
} from "../dist/system.js";
import {
  createDirectorySymlinkOrSkip,
  createTempDir,
} from "./support/helpers.mjs";

test("buildInitialConfigContent writes documented JSONC starter config", () => {
  const content = buildInitialConfigContent("~/dotfiles");

  assert.match(content, /Created by dot init/);
  assert.match(content, /"dotfilesDir": "~\/dotfiles"/);
  assert.match(content, /"links": \{\}/);
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

test("normalizePath expands home-directory shortcuts to absolute paths", () => {
  assert.equal(normalizePath("~"), resolve(homedir()));
  assert.equal(
    normalizePath("~/dotfiles"),
    resolve(join(homedir(), "dotfiles")),
  );
});

test("normalizePath does not treat tilde-prefixed names as home paths", () => {
  assert.equal(normalizePath("~dotfiles"), resolve("~dotfiles"));
});

test("preparePathForReplacement backs up physical paths", (t) => {
  const root = createTempDir(t, "dot-cli-unit-");
  const systemPath = join(root, "tool");
  mkdirSync(systemPath, { recursive: true });

  const result = preparePathForReplacement(systemPath);

  assert.equal(result.ok, true);
  assert.equal(result.action, "created-backup");
  assert.equal(existsSync(systemPath), false);
  if (result.action === "created-backup") {
    assert.equal(existsSync(result.backupPath), true);
  }
});

test("preparePathForReplacement removes link entries without touching targets", (t) => {
  const root = createTempDir(t, "dot-cli-unit-");
  const target = join(root, "repo", "tool");
  const systemPath = join(root, "system", "tool");
  mkdirSync(target, { recursive: true });
  mkdirSync(join(root, "system"), { recursive: true });

  if (!createDirectorySymlinkOrSkip(t, target, systemPath)) {
    return;
  }

  const result = preparePathForReplacement(systemPath);

  assert.equal(result.ok, true);
  assert.equal(result.action, "removed-link");
  assert.equal(existsSync(systemPath), false);
  assert.equal(existsSync(target), true);

  assert.deepEqual(restorePreparedPath(systemPath, result), { ok: true });
  assert.equal(existsSync(systemPath), true);
});

test("restorePreparedPath restores a physical backup after a failed replacement", (t) => {
  const root = createTempDir(t, "dot-cli-recovery-");
  const systemPath = join(root, "settings");
  writeFileSync(systemPath, "preserved\n");
  const prepared = preparePathForReplacement(systemPath);
  assert.equal(prepared.ok, true);
  writeFileSync(systemPath, "new destination\n");
  assert.equal(restorePreparedPath(systemPath, prepared).ok, false);
  assert.equal(readFileSync(systemPath, "utf8"), "new destination\n");
  unlinkSync(systemPath);
  assert.deepEqual(restorePreparedPath(systemPath, prepared), { ok: true });
  assert.equal(readFileSync(systemPath, "utf8"), "preserved\n");
});

test("copy comparison detects content changes beyond the first buffer", (t) => {
  const root = createTempDir(t, "dot-cli-copy-");
  const source = join(root, "source");
  const destination = join(root, "destination");
  const data = Buffer.alloc(150_000, 42);
  writeFileSync(source, data);
  writeFileSync(destination, data);
  assert.deepEqual(compareDotfileCopies(source, destination), {
    ok: true,
    matches: true,
  });
  data[140_000] = 43;
  writeFileSync(destination, data);
  assert.deepEqual(compareDotfileCopies(source, destination), {
    ok: true,
    matches: false,
  });
  writeFileSync(source, data);
  writeFileSync(destination, Buffer.concat([data, Buffer.from("extra")]));
  assert.deepEqual(compareDotfileCopies(source, destination), {
    ok: true,
    matches: false,
  });
  writeFileSync(source, "");
  writeFileSync(destination, "");
  assert.deepEqual(compareDotfileCopies(source, destination), {
    ok: true,
    matches: true,
  });
});

test("copy comparison checks directory entries without following symlink cycles", (t) => {
  const root = createTempDir(t, "dot-cli-copy-links-");
  const source = join(root, "source");
  const destination = join(root, "destination");
  mkdirSync(source);
  mkdirSync(destination);
  if (!createDirectorySymlinkOrSkip(t, source, join(source, "loop"))) return;
  if (!createDirectorySymlinkOrSkip(t, source, join(destination, "loop")))
    return;
  assert.deepEqual(compareDotfileCopies(source, destination), {
    ok: true,
    matches: true,
  });
  writeFileSync(join(destination, "extra"), "extra");
  assert.deepEqual(compareDotfileCopies(source, destination), {
    ok: true,
    matches: false,
  });
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

test("checkJunction reports missing repository target as unhealthy", (t) => {
  const root = createTempDir(t, "dot-cli-unit-");
  const repoPath = join(root, "repo", "nvim");
  const systemPath = join(root, "system", "nvim");

  assert.deepEqual(checkJunction({ name: "nvim", repoPath, systemPath }), {
    linked: false,
    message: "Target does not exist in repository",
  });
});

test("checkJunction describes the physical system path rather than the repository target", (t) => {
  const root = createTempDir(t, "dot-cli-unit-");
  const repoPath = join(root, "repo", "gitconfig");
  const systemPath = join(root, "system", "gitconfig");
  mkdirSync(join(root, "repo"), { recursive: true });
  mkdirSync(systemPath, { recursive: true });
  writeFileSync(repoPath, "config\n");

  assert.deepEqual(checkJunction({ name: "gitconfig", repoPath, systemPath }), {
    linked: false,
    message: "Physical directory exists, but is not a link",
  });
});
