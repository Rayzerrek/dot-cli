# Changelog

All notable changes to this project will be documented in this file.

This project follows npm package versions published for `@rayzerrek/dot-cli`.

## [1.1.0] - 2026-10-08

### Added

- `dot add <path> [--name <name>]` registers configs for the current platform while preserving JSONC comments and existing platform mappings.
- Compact config syntax: `"links": { "nvim": "~/.config/nvim" }`. Existing array configs remain supported.
- `--dry-run` previews link, deploy, pull, and update operations without writing files.
- `dot pull` downloads fast-forward updates from origin and refuses local changes.
- `dot init [repository] -c <path>` creates portable configs; project `dot.config.jsonc` / `dot.config.json` files are discovered from the current directory.
- Status recognizes matching deployed copies and detects changed, missing, or additional content.

### Changed

- Shortened the README, contribution guide, and example config around first use.
- Added npm search keywords and included the example config in the published package.
- Simplified terminal help and headings; redirected output and `NO_COLOR` omit ANSI colors.
- Relative config paths resolve from the config file directory; project config takes precedence over global config.
- Removed the config hash cache so loading config is read-only.
- Deploy skips matching copies and prepares complete copies before replacing destinations.
- Copy comparison reuses directory metadata and fixed-size buffers to reduce filesystem calls and memory allocation.
- Git status shows branch information and safely handles names containing spaces or Unicode.
- CI covers Node.js 22 and 24 on Windows, macOS, and Linux; publishing runs tests first.

### Fixed

- Command-level `--help`, `-h`, and `dot help <command>` show help without running commands.
- Unexpected arguments are rejected before commands can change files.
- Commands that need configuration fail with a `dot init` hint when none is found.
- Empty link and deploy configurations explain how to add links instead of exiting silently.
- Update retries existing unpushed commits after a failed push, and checks branch, identity, repository root, remote, and merge conflicts before staging changes.
- Failed replacements restore previous destinations; backup names do not overwrite existing backups.
- Deploy refreshes Linux/macOS file and directory permissions even when contents match, including executable scripts.
- Config validation reports syntax error line and column, rejects blank paths and overlapping destinations, accepts symlinked config files, and prevents circular paths through symlink aliases.
- Windows link checks accept differences in path casing; subprocesses avoid opening extra console windows.

## [1.0.26] - 2026-07-11

### Added

- Added interactive confirmation to `dot update`, with `-y` / `--yes` for automation.
- Added support for linking and migrating individual files in addition to directories.

### Changed

- Reduced unnecessary Git subprocesses when an update is cancelled.
- Avoided rewriting the configuration hash cache when the configuration is unchanged.
- Added strict update-option parsing and support for literal commit message flags after `--`.

### Fixed

- Fixed status messages for file and directory conflicts.
- Restored migrated configurations when link creation fails.
- Included stale file links in safe link cleanup.

## [1.0.25] - 2026-06-08

### Added

- Added `dot deploy` to copy dotfiles into configured system locations without creating symlinks.
- Added repository-local config discovery for freshly cloned dotfiles repositories.
- Added `--config` / `-c` for commands that load configuration.

### Changed

- Documented deploy-first setup for freshly cloned dotfiles repositories.

## [1.0.24] - 2026-06-01

### Added

- Added project contribution and security documentation.
- Added `dot --version` / `dot version`.
- Added clearer Git identity pre-flight errors before `dot update` commits.

### Changed

- Expanded CI to run tests on Linux, macOS, and Windows.

### Fixed

- Fixed local migration to move files into the repository instead of copying them.
- Fixed relative link target handling when checking current and stale links.
- Hardened config parsing, config-file detection, circular-link validation, and Windows reserved link names.

## [1.0.23] - 2026-05-30

### Fixed

- Group Git changes by config path when building update output.

## [1.0.22] - 2026-05-30

### Fixed

- Hardened config loading.
- Improved link creation safety.

## [1.0.21] - 2026-05-28

### Fixed

- Excluded standalone executable output from the npm package.

## [1.0.20] - 2026-05-28

### Changed

- Split the CLI implementation into smaller modules.

## [1.0.19] - 2026-05-27

### Added

- Added the `init` command for creating the default configuration file.

## [1.0.18] - 2026-05-27

### Changed

- Maintenance release.

## [1.0.17] - 2026-05-27

### Changed

- Simplified commit message building.
- Removed a redundant filesystem existence guard.

## [1.0.16] - 2026-05-27

### Changed

- Refactored comments and build scripts.
- Upgraded TypeScript to 6.0.3.

## [1.0.15] - 2026-05-27

### Fixed

- Updated CI setup to install Bun before `npm install`, allowing the prepare hook to build correctly.

## [1.0.14] - 2026-05-27

### Added

- Clean up stale system links when their config entry is removed.

## [1.0.13] - 2026-05-26

### Added

- Added Bun-based fast builds.
- Added configuration auto-migration.

[Unreleased]: https://github.com/Rayzerrek/dot-cli/compare/v1.0.26...HEAD
[1.0.26]: https://github.com/Rayzerrek/dot-cli/compare/v1.0.25...v1.0.26
[1.0.25]: https://github.com/Rayzerrek/dot-cli/compare/v1.0.24...v1.0.25
[1.0.24]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.24
[1.0.23]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.23
[1.0.22]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.22
[1.0.21]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.21
[1.0.20]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.20
[1.0.19]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.19
[1.0.18]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.18
[1.0.17]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.17
[1.0.16]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.16
[1.0.15]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.15
[1.0.14]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.14
[1.0.13]: https://github.com/Rayzerrek/dot-cli/releases/tag/v1.0.13
