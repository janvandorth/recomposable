```
  __      __ _  _   _   _    ___
  \ \    / /| || | /_\ | |  | __|        .
   \ \/\/ / | __ |/ _ \| |__| _|       ":"
    \_/\_/  |_||_/_/ \_|____|___|   ___:____     |"\/"|
                                  ,'        `.    \  /
   docker compose manager         |  O        \___/  |
                                  ~^~^~^~^~^~^~^~^~^~^~^~
```

# recomposable

A lightweight Docker Compose TUI manager with vim keybindings. Monitor service status, restart or rebuild containers, and tail logs — all from your terminal.

Zero dependencies. Pure Node.js.

## Install

```bash
npm install -g recomposable
```

This registers the `recomposable` command on your system.

## Quick Start

1. Navigate to your project directory (where your `docker-compose.yml` lives)
2. Create a `recomposable.json` config file
3. Run `recomposable`

```bash
cd ~/my-project
cat > recomposable.json << 'EOF'
{
  "composeFiles": [
    "docker-compose.yml"
  ]
}
EOF
recomposable
```

## Adding Compose Files

Create a `recomposable.json` file in your project root:

```json
{
  "composeFiles": [
    "docker-compose.yml"
  ],
  "pollInterval": 3000,
  "logTailLines": 100
}
```

### Multiple compose files

```json
{
  "composeFiles": [
    "docker-compose.yml",
    "docker-compose.override.yml",
    "infra/docker-compose.monitoring.yml"
  ]
}
```

### CLI override

You can skip `recomposable.json` entirely and pass compose files directly:

```bash
recomposable -f docker-compose.yml
recomposable -f docker-compose.yml -f docker-compose.prod.yml
```

## Configuration

| Option | Default | Description |
|---|---|---|
| `composeFiles` | `[]` | Array of docker-compose file paths (relative to `recomposable.json`) |
| `pollInterval` | `3000` | Status polling interval in milliseconds |
| `logTailLines` | `100` | Number of log lines to show when entering log view |

## Keybindings

| Key | Action |
|---|---|
| `j` / `Down` | Move cursor down |
| `k` / `Up` | Move cursor up |
| `s` | Restart selected service |
| `r` | Rebuild selected service (`up -d --build`) |
| `l` / `Enter` | View logs for selected service |
| `Esc` / `l` | Exit log view |
| `G` | Jump to bottom |
| `gg` | Jump to top |
| `q` | Quit |
| `Ctrl+C` | Quit |

## Status Icons

| Icon | Meaning |
|---|---|
| Green circle | Running (healthy) |
| Red circle | Running (unhealthy) |
| Yellow circle | Rebuilding / Restarting |
| Gray circle | Stopped |

## Requirements

- Node.js >= 16
- Docker with `docker compose` (v2) CLI

## License

MIT
