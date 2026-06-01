# Dotfiles CLI (`dot`)

[![npm version](https://img.shields.io/npm/v/@rayzerrek/dot-cli.svg?style=flat-square)](https://www.npmjs.com/package/@rayzerrek/dot-cli)
[![npm downloads](https://img.shields.io/npm/dm/@rayzerrek/dot-cli.svg?style=flat-square)](https://www.npmjs.com/package/@rayzerrek/dot-cli)

A lightweight, high-performance, cross-platform CLI manager to keep system configurations (`dotfiles`) in sync across Windows, macOS, and Linux.


## Installation

### Via npm (Recommended)

Install the CLI globally on your system:

```bash
npm install -g @rayzerrek/dot-cli
```

Or run it instantly without installation using `npx`:

```bash
npx @rayzerrek/dot-cli status
```

### From Source

If you prefer to clone the repository and run or link it locally:

```bash
# Clone the repository and install dependencies
git clone https://github.com/Rayzerrek/dot-cli.git
cd dot-cli
npm install

# Compile TypeScript to JavaScript
npm run build

# Link the CLI globally to your system
npm link
```


## Configuration

The CLI supports dynamic links and custom repository locations using a `config.jsonc` (JSON with Comments) file.

1. Create a configuration folder at `~/.config/dot/` (or use `~/.dotrc.jsonc` in your home directory).
2. Copy `config.example.jsonc` to `~/.config/dot/config.jsonc`:
   ```bash
   cp config.example.jsonc ~/.config/dot/config.jsonc
   ```
3. Edit `~/.config/dot/config.jsonc` to define your links. 

### Configuration Format

```json
{
  "dotfilesDir": "~/dotfiles",
  "links": [
    {
      "name": "nvim",
      "systemPath": {
        "windows": "~/AppData/Local/nvim",
        "macos": "~/.config/nvim",
        "linux": "~/.config/nvim"
      }
    }
  ]
}
```
- **`dotfilesDir`**: The absolute path to your central dotfiles repository (defaults to `~/dotfiles` or `DOTFILES_DIR` environment variable).
- **`links`**: An array of folders to link:
  - **`name`**: The directory name in your dotfiles repository and the label shown in the CLI.
  - **`systemPath`**: The destination path where the link should sit on the system (can be a plain string, or a platform-specific object supporting `windows`, `macos`, and `linux`).

## Usage

```bash
# Check the state of system links and the git repository
dot status

# Create the default configuration file
dot init

# Restore or recreate missing system links 
dot link

# Stage, commit, and push changes to your dotfiles repository
dot update [optional_message]

# Display installed version
dot --version

# Display help
dot help
```
