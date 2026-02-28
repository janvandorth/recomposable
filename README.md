# recomposable

A lightweight Docker Compose TUI manager with vim keybindings. Monitor service status, restart and/or rebuild services, switch workspaces for individual services and tail logs — all from your terminal.

Eliminate switching between countless terminal tabs or windows to rebuild you docker compose containers.

Zero dependencies. Pure Node.js.

![recomposable demo](screenshots/demo.gif)

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

## Features

- **Multi-file support** — manage services across multiple compose files, grouped by file
- **Live status** — polls container state, health, build and restart times
- **CPU/Memory monitoring** — live CPU% and memory usage per container, with configurable color thresholds
- **Port mappings** — shows published ports for each service
- **Log pattern scanning** — counts WRN/ERR (configurable) occurrences across all services
- **Inline log panel** — tail logs for the selected service without leaving the list view, with search (`/`)
- **Full log view** — scrollable full-screen log viewer with live auto-scroll and search (`/`, `n`/`N`)
- **Start / Stop / Restart / Rebuild** — full container lifecycle management per service
- **No cache mode** — toggle to force a full clean rebuild (`--no-cache` + `--force-recreate`), off by default
- **Docker Compose Watch** — toggle `docker compose watch` per service, with live output in the log panel
- **Dependency-aware rebuild** — rebuild a service then automatically restart all its transitive dependents in topological order
- **Container exec** — run commands inside any container, inline in the bottom panel (`e`) or full-screen (`x`), with `cd` support and command history
- **Worktree switching** — switch any service to run from a different git worktree (`t`), automatically rebuilds and starts in the target branch
- **Vim keybindings** — navigate with `j`/`k`, `G`/`gg`, and more

## Full Log View

![recomposable full logs view](screenshots/logs-view.png)

## Exec Mode

Run commands inside any running container without leaving the TUI. Press `e` for inline exec in the bottom panel, or `x` for full-screen exec. `cd` works — the working directory is tracked across commands.

![recomposable exec view](screenshots/exec-view.png)

## Docker Compose Watch

Press `w` to toggle `docker compose watch` for a service. A cyan `W` indicator appears next to watched services, and watch output streams to the inline log panel. Requires Docker Compose v2.22+.

## Dependency-Aware Rebuild

Press `d` to rebuild the selected service and then automatically restart all services that depend on it (transitively), in the correct topological order. Progress is shown step-by-step in the log panel. If the service has no dependents, falls back to a regular rebuild.

## Worktree Switching

Press `t` on any service to switch it to a different git worktree. A picker shows all available worktrees — navigate with `j`/`k`, confirm with `Enter`. The service is automatically stopped, rebuilt, and started from the target worktree's compose file. A `WORKTREE` column appears when services run from multiple branches, with non-main branches highlighted in yellow.

This is useful for end-to-end testing changes across branches without drowning in terminal tabs. Run your main stack on `main`, then switch individual services to feature branches to verify their behavior in the full environment. Particularly handy when letting Claude Code work in worktrees — switch the affected service, verify it end-to-end, and switch back, all from a single terminal.

![recomposable worktree gif](screenshots/worktree.gif)

## Adding Compose Files

Create a `recomposable.json` file in your project root:

```json
{
  "composeFiles": [
    "docker-compose.yml"
  ]
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
| `logTailLines` | `100` | Number of log lines to show when entering full log view |
| `logScanPatterns` | `["WRN]", "ERR]"]` | Patterns to count in container logs |
| `logScanLines` | `1000` | Number of log lines to scan for pattern counts |
| `logScanInterval` | `10000` | Pattern scanning interval in milliseconds |
| `bottomLogCount` | `10` | Number of log lines shown in the inline log panel |
| `statsInterval` | `5000` | CPU/memory polling interval in milliseconds |
| `statsBufferSize` | `6` | Number of samples for rolling average (e.g. 6 x 5s = 30s window) |
| `cpuWarnThreshold` | `50` | CPU % above which the column turns yellow |
| `cpuDangerThreshold` | `100` | CPU % above which the column turns red |
| `memWarnThreshold` | `512` | Memory in MB above which the column turns yellow |
| `memDangerThreshold` | `1024` | Memory in MB above which the column turns red |

## Keybindings

### List view

| Key | Action |
|---|---|
| `j` / `Down` | Move cursor down |
| `k` / `Up` | Move cursor up |
| `s` | Start (if stopped) or restart (if running) |
| `p` | Stop selected service |
| `b` | Rebuild selected service (`up -d --build`) |
| `d` | Dependency-aware rebuild (rebuild + restart all dependents) |
| `w` | Toggle Docker Compose Watch for selected service |
| `e` | Inline exec in bottom panel |
| `x` | Full-screen exec mode |
| `n` | Toggle no-cache mode (rebuild with `--no-cache` + `--force-recreate`) |
| `f` / `Enter` | Full-screen log view for selected service |
| `t` | Switch service to a different git worktree |
| `l` | Toggle inline log panel |
| `/` | Search in inline log panel |
| `G` | Jump to bottom |
| `gg` | Jump to top |
| `q` | Quit |

### Full log view

| Key | Action |
|---|---|
| `j` / `Down` | Scroll down |
| `k` / `Up` | Scroll up |
| `Ctrl+D` | Page down |
| `Ctrl+U` | Page up |
| `G` | Jump to bottom (live mode) |
| `gg` | Jump to top |
| `/` | Search logs |
| `n` | Next search match |
| `N` | Previous search match |
| `Esc` / `f` | Exit log view |
| `q` | Quit |

### Exec mode (inline & full-screen)

| Key | Action |
|---|---|
| Type | Enter commands |
| `Enter` | Execute command |
| `Up` / `Down` | Navigate command history |
| `x` | Expand inline exec to full screen |
| `Ctrl+C` | Kill running command (double to quit) |
| `Esc` | Exit exec mode |

## Status Icons

| Icon | Meaning |
|---|---|
| Green circle | Running (healthy) |
| Red circle | Running (unhealthy) |
| Yellow circle | Rebuilding / Restarting / Starting / Stopping |
| Gray circle | Stopped |
| Cyan `W` | Docker Compose Watch active |

## Todo

- Log search should search all container logs, not only the lines currently tailed by the tool

## Requirements

- Node.js >= 16
- Docker with `docker compose` (v2) CLI

## BLog posts
- https://dev.to/janvandorth/every-docker-compose-tui-i-could-find-and-why-i-built-my-own-2oo0
- https://dev.to/janvandorth/testing-microservice-changes-from-git-worktrees-end-to-end-without-the-terminal-tab-explosion-e1f

## License

MIT
