import { compareDotfileCopies } from "./copy-status.js";
import { printGitRepositoryStatus } from "./git.js";
import { checkJunction } from "./links.js";
import { safeLstat } from "./system.js";
import { bold, green, header, logInfo, red, yellow } from "./ui.js";

import type { AppConfig } from "./types.js";

/**
 * Prints the health of configured system links and the git status of the
 * dotfiles repository.
 *
 * The returned boolean is suitable for process exit-code decisions: `false`
 * means at least one configured link is unhealthy or repository status could
 * not be queried.
 */
export function handleStatus({ dotfilesDir, links }: AppConfig): boolean {
  console.log(header("Config Status"));
  if (links.length === 0)
    logInfo("No configs registered for this platform. Run: dot add <path>");

  let ok = true;
  let ready = 0;
  for (const link of links) {
    let result = checkJunction(link);
    const destination = safeLstat(link.systemPath);
    if (
      !result.linked &&
      destination &&
      !destination.isSymbolicLink() &&
      safeLstat(link.repoPath)
    ) {
      const copy = compareDotfileCopies(link.repoPath, link.systemPath);
      result = copy.ok
        ? {
            linked: copy.matches,
            message: copy.matches
              ? "Copy matches repository"
              : "Copy differs from repository (local edits are not synced)",
          }
        : { linked: false, message: `Could not compare copy: ${copy.error}` };
    }
    if (result.linked) {
      ready += 1;
      console.log(
        `  ${green("[✔ ]")} ${bold(`${link.name}:`)} ${result.message}`,
      );
    } else {
      ok = false;
      console.log(
        `  ${red("[✘ ]")} ${bold(`${link.name}:`)} ${yellow(result.message)}`,
      );
    }
  }
  if (links.length > 0) console.log(`\n${ready}/${links.length} configs ready`);

  console.log(header("Git Repository Status (dotfiles)"));
  return printGitRepositoryStatus(dotfilesDir) && ok;
}
