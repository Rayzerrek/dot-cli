import { readFileSync, writeFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);

if (
  typeof packageJson !== "object" ||
  packageJson === null ||
  Array.isArray(packageJson)
) {
  throw new Error("package.json must be a JSON object");
}

const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("package.json must contain a non-empty version string");
}

const content = [
  "/** dot-cli package version generated from package.json at build time. */",
  `export const VERSION = ${JSON.stringify(version)};`,
  "",
].join("\n");

writeFileSync(new URL("../src/version.ts", import.meta.url), content);
