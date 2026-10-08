# Contributing

Bug fixes, clearer documentation, and cross-platform testing are welcome. Open an issue before starting a larger change.

## Development

```sh
git clone https://github.com/Rayzerrek/dot-cli.git
cd dot-cli
npm ci
npm test
```

`npm test` builds TypeScript and runs the tests. Use `npm run build` to build only, then `node dist/index.js --help` to try the CLI locally. Use `npm link` if you want the `dot` command on your PATH.

## Changes

- Keep changes focused and follow the existing TypeScript style.
- Validate external inputs; preserve type safety and explicit failures.
- Preserve user files and guard platform-specific filesystem behavior.
- Avoid new runtime dependencies unless needed.
- Test changed behavior and update help and documentation together.

Run `npm test` before opening a PR. CI tests on Windows, macOS, and Linux.

For bug reports, include `dot --version`, your OS, the command, a config snippet with secrets removed, and expected versus actual behavior.

Report security issues privately: [SECURITY.md](./SECURITY.md).
