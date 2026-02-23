#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { listServices, getStatuses, rebuildService, tailLogs } = require('./lib/docker');
const { MODE, createState, statusKey, buildFlatList, moveCursor, selectedEntry } = require('./lib/state');
const { clearScreen, showCursor, renderListView, renderLogHeader } = require('./lib/renderer');

// --- Config ---

function loadConfig() {
  const defaults = { composeFiles: [], pollInterval: 3000, logTailLines: 100 };

  // Load from dockman.json next to this script
  const configPath = path.join(__dirname, 'dockman.json');
  if (fs.existsSync(configPath)) {
    Object.assign(defaults, JSON.parse(fs.readFileSync(configPath, 'utf8')));
  }

  // CLI overrides: -f <file> can be repeated
  const args = process.argv.slice(2);
  const cliFiles = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-f' && args[i + 1]) {
      cliFiles.push(args[++i]);
    }
  }
  if (cliFiles.length > 0) {
    defaults.composeFiles = cliFiles;
  }

  if (defaults.composeFiles.length === 0) {
    process.stderr.write('No compose files configured. Add them to dockman.json or pass -f <file>.\n');
    process.exit(1);
  }

  return defaults;
}

// --- Service Discovery ---

function discoverServices(config) {
  const groups = [];
  for (const file of config.composeFiles) {
    const resolved = path.resolve(file);
    const label = path.basename(file, path.extname(file)).replace(/^docker-compose\.?/, '') || path.basename(file);
    let services = [];
    let error = null;
    try {
      services = listServices(resolved);
    } catch (e) {
      error = e.message.split('\n')[0].substring(0, 60);
    }
    groups.push({ file: resolved, label, services, error });
  }
  return groups;
}

// --- Status Polling ---

function pollStatuses(state) {
  for (const group of state.groups) {
    if (group.error) continue;
    const statuses = getStatuses(group.file);
    for (const [svc, st] of statuses) {
      state.statuses.set(statusKey(group.file, svc), st);
    }
  }
}

// --- Rendering ---

function render(state) {
  let output = clearScreen();
  if (state.mode === MODE.LIST) {
    output += renderListView(state);
  }
  process.stdout.write(output);
}

// --- Actions ---

function doRebuild(state) {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.rebuilding.has(sk)) return;

  const child = rebuildService(entry.file, entry.service);
  state.rebuilding.set(sk, child);
  render(state);

  child.on('close', () => {
    state.rebuilding.delete(sk);
    pollStatuses(state);
    if (state.mode === MODE.LIST) render(state);
  });
}

function enterLogs(state) {
  const entry = selectedEntry(state);
  if (!entry) return;

  state.mode = MODE.LOGS;

  // Clear screen and show log header
  process.stdout.write(clearScreen() + renderLogHeader(entry.service) + '\n');

  const child = tailLogs(entry.file, entry.service, state.config.logTailLines);
  state.logChild = child;

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stdout);

  child.on('close', () => {
    if (state.logChild === child) {
      state.logChild = null;
    }
  });
}

function exitLogs(state) {
  if (state.logChild) {
    state.logChild.kill('SIGTERM');
    state.logChild = null;
  }
  state.mode = MODE.LIST;
  pollStatuses(state);
  render(state);
}

// --- Input Handling ---

function handleKeypress(state, key) {
  // Ctrl+C always quits
  if (key === '\x03') {
    cleanup(state);
    process.exit(0);
  }

  if (state.mode === MODE.LOGS) {
    if (key === 'l' || key === '\x1b' || key === 'q') {
      if (key === 'q') {
        cleanup(state);
        process.exit(0);
      }
      exitLogs(state);
    }
    return;
  }

  // LIST mode
  switch (key) {
    case 'j':
    case '\x1b[B': // Arrow Down
      moveCursor(state, 1);
      render(state);
      break;
    case 'k':
    case '\x1b[A': // Arrow Up
      moveCursor(state, -1);
      render(state);
      break;
    case 'r':
      doRebuild(state);
      break;
    case 'l':
    case '\r': // Enter
      enterLogs(state);
      break;
    case 'q':
      cleanup(state);
      process.exit(0);
      break;
    case 'G': // vim: go to bottom
      state.cursor = state.flatList.length - 1;
      render(state);
      break;
    case 'g': // gg handled via double-tap buffer below
      break;
  }
}

// --- Arrow key sequence buffering ---

function createInputHandler(state) {
  let buf = '';
  let gPending = false;

  return function onData(data) {
    const str = data.toString();

    // Handle escape sequences (arrow keys)
    buf += str;

    while (buf.length > 0) {
      // Check for escape sequences
      if (buf === '\x1b') {
        // Could be start of escape sequence — wait for more
        setTimeout(() => {
          if (buf === '\x1b') {
            handleKeypress(state, '\x1b');
            buf = '';
          }
        }, 50);
        return;
      }

      if (buf.startsWith('\x1b[A')) {
        handleKeypress(state, '\x1b[A');
        buf = buf.slice(3);
        continue;
      }
      if (buf.startsWith('\x1b[B')) {
        handleKeypress(state, '\x1b[B');
        buf = buf.slice(3);
        continue;
      }
      if (buf.startsWith('\x1b[')) {
        // Unknown escape sequence — skip it
        buf = buf.slice(buf.length);
        continue;
      }

      // Single character
      const ch = buf[0];
      buf = buf.slice(1);

      // Handle gg (go to top)
      if (ch === 'g') {
        if (gPending) {
          gPending = false;
          state.cursor = 0;
          state.scrollOffset = 0;
          render(state);
          continue;
        }
        gPending = true;
        setTimeout(() => {
          if (gPending) {
            gPending = false;
            // Single g — ignore
          }
        }, 300);
        continue;
      }

      gPending = false;
      handleKeypress(state, ch);
    }
  };
}

// --- Cleanup ---

function cleanup(state) {
  if (state.logChild) {
    state.logChild.kill('SIGTERM');
    state.logChild = null;
  }
  for (const [, child] of state.rebuilding) {
    child.kill('SIGTERM');
  }
  state.rebuilding.clear();
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  process.stdout.write(showCursor() + '\x1b[0m');
}

// --- Main ---

function main() {
  const config = loadConfig();
  const state = createState(config);

  // Discover services
  state.groups = discoverServices(config);
  state.flatList = buildFlatList(state.groups);

  if (state.flatList.length === 0) {
    process.stderr.write('No services found in any compose file.\n');
    process.exit(1);
  }

  // Initial status poll
  pollStatuses(state);

  // Setup terminal
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', createInputHandler(state));

  // Render
  render(state);

  // Poll loop
  state.pollTimer = setInterval(() => {
    if (state.mode === MODE.LIST) {
      pollStatuses(state);
      render(state);
    }
  }, config.pollInterval);

  // Terminal resize
  process.stdout.on('resize', () => {
    if (state.mode === MODE.LIST) render(state);
  });

  // Cleanup on exit
  process.on('exit', () => cleanup(state));
  process.on('SIGINT', () => {
    cleanup(state);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup(state);
    process.exit(0);
  });
}

main();
