#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { listServices, getStatuses, rebuildService, restartService, tailLogs, getContainerId, tailContainerLogs, fetchContainerLogs } = require('./lib/docker');
const { MODE, createState, statusKey, buildFlatList, moveCursor, selectedEntry } = require('./lib/state');
const { clearScreen, showCursor, renderListView, renderLogView } = require('./lib/renderer');

// --- Config ---

function loadConfig() {
  const defaults = { composeFiles: [], pollInterval: 3000, logTailLines: 100, logScanPatterns: ['WRN]', 'ERR]'], logScanLines: 1000, logScanInterval: 10000 };

  // Load from recomposable.json in current working directory
  const configPath = path.join(process.cwd(), 'recomposable.json');
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
    process.stderr.write('No compose files configured. Add them to recomposable.json or pass -f <file>.\n');
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

// --- Log Pattern Scanning ---

let logScanActive = false;

function pollLogCounts(state) {
  if (logScanActive) return;
  const scanPatterns = state.config.logScanPatterns || [];
  if (scanPatterns.length === 0) return;
  const tailLines = state.config.logScanLines || 1000;

  const toScan = [];
  for (const group of state.groups) {
    if (group.error) continue;
    for (const service of group.services) {
      const sk = statusKey(group.file, service);
      const st = state.statuses.get(sk);
      if (!st || st.state !== 'running' || !st.id) continue;
      toScan.push({ sk, containerId: st.id });
    }
  }

  if (toScan.length === 0) return;
  logScanActive = true;
  let remaining = toScan.length;

  for (const { sk, containerId } of toScan) {
    const child = fetchContainerLogs(containerId, tailLines);
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });
    child.on('close', () => {
      const counts = new Map();
      for (const pattern of scanPatterns) {
        let count = 0;
        let idx = 0;
        while ((idx = output.indexOf(pattern, idx)) !== -1) {
          count++;
          idx += pattern.length;
        }
        counts.set(pattern, count);
      }
      state.logCounts.set(sk, counts);
      remaining--;
      if (remaining === 0) {
        logScanActive = false;
        if (state.mode === MODE.LIST) throttledRender(state);
      }
    });
    child.on('error', () => {
      remaining--;
      if (remaining === 0) {
        logScanActive = false;
        if (state.mode === MODE.LIST) throttledRender(state);
      }
    });
  }
}

// --- Rendering ---

function render(state) {
  let output = clearScreen();
  if (state.mode === MODE.LIST) {
    output += renderListView(state);
  } else if (state.mode === MODE.LOGS) {
    output += renderLogView(state);
  }
  process.stdout.write(output);
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g, '');
}

let lastRenderTime = 0;
let pendingRender = null;
let logFetchTimer = null;

function throttledRender(state) {
  const now = Date.now();
  const elapsed = now - lastRenderTime;
  if (elapsed >= 150) {
    lastRenderTime = now;
    render(state);
  } else if (!pendingRender) {
    pendingRender = setTimeout(() => {
      pendingRender = null;
      lastRenderTime = Date.now();
      render(state);
    }, 150 - elapsed);
  }
}

// --- Actions ---

function updateSelectedLogs(state) {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);

  // Same container already selected, nothing to do
  if (state.selectedLogKey === sk) return;

  // Cancel any pending debounced log fetch
  if (logFetchTimer) {
    clearTimeout(logFetchTimer);
    logFetchTimer = null;
  }

  // Clean up previous selected container's passive log tail
  if (state.selectedLogKey) {
    const oldInfo = state.bottomLogLines.get(state.selectedLogKey);
    if (oldInfo && (oldInfo.action === 'logs' || oldInfo.action === 'started')) {
      if (!state.rebuilding.has(state.selectedLogKey) && !state.restarting.has(state.selectedLogKey)) {
        state.bottomLogLines.delete(state.selectedLogKey);
        if (state.bottomLogTails.has(state.selectedLogKey)) {
          state.bottomLogTails.get(state.selectedLogKey).kill('SIGTERM');
          state.bottomLogTails.delete(state.selectedLogKey);
        }
      }
    }
  }

  state.selectedLogKey = sk;

  // If this container already has active action logs (rebuild/restart/started), keep those
  if (state.bottomLogLines.has(sk)) return;

  // Set up empty log entry immediately so the UI shows the container name
  state.bottomLogLines.set(sk, { action: 'logs', service: entry.service, lines: [] });

  // Debounce the expensive log fetch (getContainerId is a blocking execFileSync)
  logFetchTimer = setTimeout(() => {
    logFetchTimer = null;
    startBottomLogTail(state, sk, entry.file, entry.service);
  }, 500);
}

function doRebuild(state) {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.rebuilding.has(sk)) return;

  // Kill any existing startup log tail for this service
  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk).kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const child = rebuildService(entry.file, entry.service);
  state.rebuilding.set(sk, child);

  state.bottomLogLines.set(sk, { action: 'rebuilding', service: entry.service, lines: [] });

  let lineBuf = '';
  const onData = (data) => {
    const info = state.bottomLogLines.get(sk);
    if (!info) return;
    lineBuf += data.toString();
    const parts = lineBuf.split(/\r?\n|\r/);
    lineBuf = parts.pop();
    const newLines = parts.filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
    if (newLines.length === 0) return;
    info.lines.push(...newLines);
    if (info.lines.length > 10) info.lines = info.lines.slice(-10);
    if (state.mode === MODE.LIST) throttledRender(state);
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  render(state);

  child.on('close', () => {
    state.rebuilding.delete(sk);
    pollStatuses(state);

    // Show container application logs after rebuild+start
    const info = state.bottomLogLines.get(sk);
    if (info) {
      info.action = 'started';
      info.lines = [];
    }

    startBottomLogTail(state, sk, entry.file, entry.service);
    if (state.mode === MODE.LIST) render(state);
  });
}

function startBottomLogTail(state, sk, file, service) {
  // Kill any existing tail for this service
  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk).kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  // Get container ID and use docker logs directly (avoids compose buffering)
  const containerId = getContainerId(file, service);
  if (!containerId) return;

  const logChild = tailContainerLogs(containerId, 10);
  state.bottomLogTails.set(sk, logChild);

  let buf = '';
  const onData = (data) => {
    const info = state.bottomLogLines.get(sk);
    if (!info) return;
    buf += data.toString();
    const parts = buf.split(/\r?\n|\r/);
    buf = parts.pop();
    const newLines = parts.filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
    if (newLines.length === 0) return;
    info.lines.push(...newLines);
    if (info.lines.length > 10) info.lines = info.lines.slice(-10);
    if (state.mode === MODE.LIST) throttledRender(state);
  };

  logChild.stdout.on('data', onData);
  logChild.stderr.on('data', onData);
}

function doRestart(state) {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.restarting.has(sk) || state.rebuilding.has(sk)) return;

  // Kill any existing startup log tail for this service
  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk).kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const child = restartService(entry.file, entry.service);
  state.restarting.set(sk, child);

  state.bottomLogLines.set(sk, { action: 'restarting', service: entry.service, lines: [] });
  render(state);

  child.on('close', () => {
    state.restarting.delete(sk);
    pollStatuses(state);

    // Show container application logs after restart
    const info = state.bottomLogLines.get(sk);
    if (info) {
      info.action = 'started';
      info.lines = [];
    }

    startBottomLogTail(state, sk, entry.file, entry.service);
    if (state.mode === MODE.LIST) render(state);
  });
}

function enterLogs(state) {
  const entry = selectedEntry(state);
  if (!entry) return;

  if (logFetchTimer) {
    clearTimeout(logFetchTimer);
    logFetchTimer = null;
  }

  state.mode = MODE.LOGS;
  state.logLines = [];
  state.logScrollOffset = 0;
  state.logAutoScroll = true;

  const child = tailLogs(entry.file, entry.service, state.config.logTailLines);
  state.logChild = child;

  let lineBuf = '';
  const onData = (data) => {
    lineBuf += data.toString();
    const parts = lineBuf.split(/\r?\n|\r/);
    lineBuf = parts.pop();
    if (parts.length === 0) return;
    for (const line of parts) {
      state.logLines.push(stripAnsi(line));
    }
    // Cap buffer at 10000 lines
    if (state.logLines.length > 10000) {
      const excess = state.logLines.length - 10000;
      state.logLines.splice(0, excess);
      if (!state.logAutoScroll) {
        state.logScrollOffset = Math.max(0, state.logScrollOffset - excess);
      }
    }
    if (state.logAutoScroll) {
      throttledRender(state);
    }
  };

  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', () => {
    if (state.logChild === child) {
      state.logChild = null;
    }
  });

  render(state);
}

function exitLogs(state) {
  if (state.logChild) {
    state.logChild.kill('SIGTERM');
    state.logChild = null;
  }
  state.logLines = [];
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
    const { rows = 24 } = process.stdout;
    const pageSize = Math.max(1, Math.floor(rows / 2));
    const maxOffset = Math.max(0, state.logLines.length - 1);

    switch (key) {
      case 'f':
      case '\x1b':
        exitLogs(state);
        break;
      case 'q':
        cleanup(state);
        process.exit(0);
        break;
      case 'k':
      case '\x1b[A':
        state.logAutoScroll = false;
        state.logScrollOffset = Math.min(maxOffset, state.logScrollOffset + 1);
        render(state);
        break;
      case 'j':
      case '\x1b[B':
        if (state.logScrollOffset > 0) {
          state.logScrollOffset--;
          if (state.logScrollOffset === 0) state.logAutoScroll = true;
        }
        render(state);
        break;
      case 'G':
        state.logScrollOffset = 0;
        state.logAutoScroll = true;
        render(state);
        break;
      case '\x15': // Ctrl+U - page up
        state.logAutoScroll = false;
        state.logScrollOffset = Math.min(maxOffset, state.logScrollOffset + pageSize);
        render(state);
        break;
      case '\x04': // Ctrl+D - page down
        state.logScrollOffset = Math.max(0, state.logScrollOffset - pageSize);
        if (state.logScrollOffset === 0) state.logAutoScroll = true;
        render(state);
        break;
    }
    return;
  }

  // LIST mode
  switch (key) {
    case 'j':
    case '\x1b[B': // Arrow Down
      moveCursor(state, 1);
      updateSelectedLogs(state);
      render(state);
      break;
    case 'k':
    case '\x1b[A': // Arrow Up
      moveCursor(state, -1);
      updateSelectedLogs(state);
      render(state);
      break;
    case 'r':
      doRebuild(state);
      break;
    case 's':
      doRestart(state);
      break;
    case 'f':
    case '\r': // Enter
      enterLogs(state);
      break;
    case 'l':
      state.showBottomLogs = !state.showBottomLogs;
      render(state);
      break;
    case 'q':
      cleanup(state);
      process.exit(0);
      break;
    case 'G': // vim: go to bottom
      state.cursor = state.flatList.length - 1;
      updateSelectedLogs(state);
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
          if (state.mode === MODE.LIST) {
            state.cursor = 0;
            state.scrollOffset = 0;
            updateSelectedLogs(state);
          } else if (state.mode === MODE.LOGS) {
            state.logAutoScroll = false;
            state.logScrollOffset = Math.max(0, state.logLines.length - 1);
          }
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
  for (const [, child] of state.restarting) {
    child.kill('SIGTERM');
  }
  state.restarting.clear();
  for (const [, child] of state.bottomLogTails) {
    child.kill('SIGTERM');
  }
  state.bottomLogTails.clear();
  if (logFetchTimer) {
    clearTimeout(logFetchTimer);
    logFetchTimer = null;
  }
  if (state.logScanTimer) {
    clearInterval(state.logScanTimer);
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  process.stdout.write('\x1b[r' + showCursor() + '\x1b[0m');
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

  // Initial log pattern scan
  pollLogCounts(state);

  // Start log tail for initially selected container and render
  updateSelectedLogs(state);
  render(state);

  // Poll loop
  state.pollTimer = setInterval(() => {
    if (state.mode === MODE.LIST) {
      pollStatuses(state);
      render(state);
    }
  }, config.pollInterval);

  // Log pattern scan loop
  state.logScanTimer = setInterval(() => {
    if (state.mode === MODE.LIST) {
      pollLogCounts(state);
    }
  }, config.logScanInterval || 10000);

  // Terminal resize
  process.stdout.on('resize', () => {
    render(state);
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
