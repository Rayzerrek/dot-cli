# dot — your dotfiles, everywhere

[![npm version](https://img.shields.io/npm/v/@rayzerrek/dot-cli.svg?style=flat-square)](https://www.npmjs.com/package/@rayzerrek/dot-cli)

Keep your config files in one Git repository. Link them to your apps, copy them to a new machine, and commit changes with one command. Windows, macOS, and Linux. One runtime dependency.

## Quick start

Requires Node.js. Pick an existing config file or directory; this example uses your Git config.

```sh
npm install -g @rayzerrek/dot-cli
dot add ~/.gitconfig
dot link --dry-run
dot link
```

`add` creates a config if needed and registers the path for your current OS. `link` moves your existing file into `~/dotfiles/.gitconfig` when the repository copy is missing, then links it back. Existing destination files and directories are backed up before replacement.

Use a Git repository at `~/dotfiles` for `status` and `update`: clone yours there, or run `git init ~/dotfiles`. Then:

```sh
dot status
dot update "Configure Git"
```

Set an `origin` remote before `update` (`git -C ~/dotfiles remote add origin <url>`). It shows all changes and the commit message before asking for confirmation.

On Windows, [file symlinks](https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/) need Developer Mode or an elevated terminal. Directory links use junctions. Use `dot deploy` for independent copies; later edits are not synced back.

## Commands

| Command | What it does |
| --- | --- |
| `dot init [repository]` | Create a starter config without replacing an existing one |
| `dot add <path> [--name <name>]` | Register an existing file or directory; preserve config comments |
| `dot link` | Create or repair links; migrate local configs when needed |
| `dot deploy` | Copy configs; skip matching copies and back up changed destinations |
| `dot status` | Check links, compare copies, and show Git changes and branch status |
| `dot pull` | Download updates from `origin`; fast-forward only, with a clean working tree |
| `dot update [message]` | Stage all repository changes, commit, and push to `origin` |
| `dot help [command]` | Show help; also `dot <command> --help` |

Use `--dry-run` on `link`, `deploy`, `pull`, or `update` to preview changes without writing files. Use `dot update --yes` for automation, `dot update -- "-message"` for a message starting with a dash, and `dot --version` for the installed version.

On another machine, use `dot pull` to download committed updates. Linked files update immediately; run `dot deploy` to refresh copies or `dot link` for new entries. Local edits and diverged branches require resolution before pulling.

After a failed push, repeat `dot update` with the same config to push the saved commit. `status` exits with code 1 for missing or incorrect paths, changed copies, or a failed Git check. Copy comparison checks contents, additional or missing files, and permissions on Linux/macOS; it does not follow nested symlinks.

## Configuration

JSONC supports comments and trailing commas. Edit manually or let `dot add` maintain it:

```jsonc
{
  "dotfilesDir": "~/dotfiles",
  "links": {
    ".gitconfig": "~/.gitconfig",
    "nvim": {
      "windows": "~/AppData/Local/nvim",
      "macos": "~/.config/nvim",
      "linux": "~/.config/nvim"
    }
  }
}
```

Each key is a top-level file or directory in your repository. A string applies on every OS; a platform map applies only to its listed platforms. Existing `links: [{ "name": "…", "systemPath": "…" }]` configs are still supported. Relative paths resolve from the config file's directory; `~` expands to your home directory.

Lookup order: explicit `-c` / `--config` → `dot.config.jsonc` or `dot.config.json` in the current directory → `~/.config/dot/config.jsonc`, then `config.json`, then `~/.dotrc.jsonc`, then `.dotrc.json` → `config.jsonc`, `config.json`, `dot.config.jsonc`, or `dot.config.json` in `$DOTFILES_DIR` or `~/dotfiles`.

Repository location: `dotfilesDir` in config → `DOTFILES_DIR` environment variable → config's directory for repository-local or explicit configs → `~/dotfiles`.

For a portable setup, keep `dot.config.jsonc` in your dotfiles repository and omit `dotfilesDir`. Create one with `dot init -c ~/my-dotfiles/dot.config.jsonc`. After cloning, run `dot link` from that directory, or `dot link -c ~/my-dotfiles/dot.config.jsonc` from anywhere. The `-c` option works with every config command, including `init`, `add`, and `pull`.

[Example config](./config.example.jsonc) · [Contributing](https://github.com/Rayzerrek/dot-cli/blob/master/CONTRIBUTING.md) · [Changelog](https://github.com/Rayzerrek/dot-cli/blob/master/CHANGELOG.md) · [Issues](https://github.com/Rayzerrek/dot-cli/issues) · [MIT license](./LICENSE)
