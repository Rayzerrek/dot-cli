# Changelog

All notable changes to this project will be documented in this file.

This project follows npm package versions published for `@rayzerrek/dot-cli`.

## [Unreleased]

- Added project contribution and security documentation.
- Added `dot --version` / `dot version`.
- Fixed local migration to move files into the repository instead of copying them.
- Added clearer Git identity pre-flight errors before `dot update` commits.
- Hardened config parsing, config-file detection, circular-link validation, and Windows reserved link names.
- Expanded CI to run tests on Linux, macOS, and Windows.

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

[Unreleased]: https://github.com/Rayzerrek/dot-cli/compare/v1.0.23...HEAD
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
