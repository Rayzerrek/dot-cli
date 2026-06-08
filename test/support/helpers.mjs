import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(process.cwd(), "dist", "index.js");

export function createTempDir(t, prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function createTempHome(t) {
  const root = createTempDir(t, "dot-cli-functional-");
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
  };
  delete env.DOTFILES_DIR;
  return { root, env };
}

export function runCli(args, env) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf-8",
  });
}

export function writeConfig(home, config) {
  const configDir = join(home, ".config", "dot");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.jsonc"), config);
}

export function skipWhenGitUnavailable(t) {
  const git = spawnSync("git", ["--version"], { encoding: "utf-8" });
  if (git.status === 0) {
    return false;
  }
  t.skip("git executable is unavailable");
  return true;
}

export function createDirectorySymlinkOrSkip(t, target, path) {
  try {
    symlinkSync(
      target,
      path,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (err) {
    t.skip(
      `symlink creation is unavailable in this environment: ${String(err)}`,
    );
    return false;
  }
}
