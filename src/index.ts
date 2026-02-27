#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import type { ChildProcess } from 'child_process';
import { listServices, getStatuses, rebuildService, restartService, stopService, startService, tailLogs, fetchServiceLogs, getContainerId, tailContainerLogs, fetchContainerLogs, fetchContainerStats, parseStatsLine, isWatchAvailable, watchService, parseDependencyGraph, execInContainer, getGitRoot, listGitWorktrees, validateServiceInComposeFile } from './lib/docker';
import { MODE, createState, statusKey, buildFlatList, moveCursor, selectedEntry, getEffectiveFile } from './lib/state';
import { clearScreen, showCursor, renderListView, renderLogView, renderExecView, CLEAR_EOL, CLEAR_EOS } from './lib/renderer';
import type { Config, AppState, ServiceGroup, Killable, StatsHistory, CascadeStep, CascadeOperation, GitWorktree } from './lib/types';

// --- Module-level mutable state ---

export interface ModuleState {
  logScanActive: boolean;
  statsPollActive: boolean;
  lastRenderTime: number;
  pendingRender: ReturnType<typeof setTimeout> | null;
  logFetchTimer: ReturnType<typeof setTimeout> | null;
}

export function createModuleState(): ModuleState {
  return {
    logScanActive: false,
    statsPollActive: false,
    lastRenderTime: 0,
    pendingRender: null,
    logFetchTimer: null,
  };
}

let moduleState = createModuleState();

// --- Config ---

export function loadConfig(): Config {
  const defaults: Config = {
    composeFiles: [],
    pollInterval: 3000,
    logTailLines: 100,
    logScanPatterns: [['WRN]', 'WARNING'], ['ERR]', 'ERROR']],
    logScanLines: 1000,
    logScanInterval: 10000,
    statsInterval: 5000,
    statsBufferSize: 6,
    bottomLogCount: 10,
    cpuWarnThreshold: 50,
    cpuDangerThreshold: 100,
    memWarnThreshold: 512,
    memDangerThreshold: 1024,
  };

  const configPath = path.join(process.cwd(), 'recomposable.json');
  if (fs.existsSync(configPath)) {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (Array.isArray(raw.composeFiles) && raw.composeFiles.every((f: unknown) => typeof f === 'string')) {
        defaults.composeFiles = raw.composeFiles;
      }
      if (Array.isArray(raw.logScanPatterns) && raw.logScanPatterns.every((p: unknown) =>
        typeof p === 'string' || (Array.isArray(p) && p.length > 0 && p.every((s: unknown) => typeof s === 'string'))
      )) {
        defaults.logScanPatterns = raw.logScanPatterns;
      }
      const numericFields: Array<{ key: keyof Config; min: number; max: number }> = [
        { key: 'pollInterval', min: 500, max: 300000 },
        { key: 'logTailLines', min: 1, max: 50000 },
        { key: 'logScanLines', min: 1, max: 50000 },
        { key: 'logScanInterval', min: 1000, max: 600000 },
        { key: 'statsInterval', min: 1000, max: 600000 },
        { key: 'statsBufferSize', min: 1, max: 100 },
        { key: 'bottomLogCount', min: 1, max: 200 },
        { key: 'cpuWarnThreshold', min: 0, max: 10000 },
        { key: 'cpuDangerThreshold', min: 0, max: 10000 },
        { key: 'memWarnThreshold', min: 0, max: 1048576 },
        { key: 'memDangerThreshold', min: 0, max: 1048576 },
      ];
      for (const { key, min, max } of numericFields) {
        if (typeof raw[key] === 'number' && isFinite(raw[key]) && raw[key] >= min && raw[key] <= max) {
          (defaults as unknown as Record<string, unknown>)[key] = raw[key];
        }
      }
    }
  }

  const args = process.argv.slice(2);
  const cliFiles: string[] = [];
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

export function discoverServices(config: Config): ServiceGroup[] {
  const groups: ServiceGroup[] = [];
  for (const file of config.composeFiles) {
    const resolved = path.resolve(file);
    const label = path.basename(file, path.extname(file)).replace(/^docker-compose\.?/, '') || path.basename(file);
    let services: string[] = [];
    let error: string | null = null;
    try {
      services = listServices(resolved);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      error = msg.split('\n')[0].substring(0, 60);
    }
    groups.push({ file: resolved, label, services, error });
  }
  return groups;
}

// --- Status Polling ---

export function pollStatuses(state: AppState): void {
  // Collect services by their effective file (may differ from group file due to worktree overrides)
  const fileToServices = new Map<string, Array<{ sk: string; service: string }>>();
  for (const group of state.groups) {
    if (group.error) continue;
    for (const service of group.services) {
      const sk = statusKey(group.file, service);
      const file = getEffectiveFile(state, group.file, service);
      if (!fileToServices.has(file)) fileToServices.set(file, []);
      fileToServices.get(file)!.push({ sk, service });
    }
  }
  for (const [file, services] of fileToServices) {
    const statuses = getStatuses(file);
    const serviceSet = new Set(services.map(s => s.service));
    for (const [svc, st] of statuses) {
      if (serviceSet.has(svc)) {
        // Store under the original statusKey (group.file based)
        const match = services.find(s => s.service === svc);
        if (match) state.statuses.set(match.sk, st);
      }
    }
  }
  detectMultipleWorktrees(state);
}

export function detectMultipleWorktrees(state: AppState): void {
  const worktrees = new Set<string>();
  for (const st of state.statuses.values()) {
    if (st.state === 'running' && st.worktree) {
      worktrees.add(st.worktree);
    }
  }
  state.showWorktreeColumn = worktrees.size > 1;
}

// --- Log Pattern Scanning ---

export function pollLogCounts(state: AppState): void {
  if (moduleState.logScanActive) return;
  const scanPatterns = state.config.logScanPatterns || [];
  if (scanPatterns.length === 0) return;
  const tailLines = state.config.logScanLines || 1000;

  const toScan: Array<{ sk: string; containerId: string }> = [];
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
  moduleState.logScanActive = true;
  let remaining = toScan.length;

  for (const { sk, containerId } of toScan) {
    const child = fetchContainerLogs(containerId, tailLines);
    let output = '';
    child.stdout!.on('data', (d: Buffer) => { output += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { output += d.toString(); });
    child.on('close', () => {
      const counts = new Map<string, number>();
      for (const entry of scanPatterns) {
        const group = Array.isArray(entry) ? entry : [entry];
        const key = group[0];
        let count = 0;
        for (const pattern of group) {
          let idx = 0;
          while ((idx = output.indexOf(pattern, idx)) !== -1) {
            count++;
            idx += pattern.length;
          }
        }
        counts.set(key, count);
      }
      state.logCounts.set(sk, counts);
      remaining--;
      if (remaining === 0) {
        moduleState.logScanActive = false;
        if (state.mode === MODE.LIST) throttledRender(state);
      }
    });
    child.on('error', () => {
      remaining--;
      if (remaining === 0) {
        moduleState.logScanActive = false;
        if (state.mode === MODE.LIST) throttledRender(state);
      }
    });
  }
}

// --- Stats Polling ---

export function pollContainerStats(state: AppState): void {
  if (moduleState.statsPollActive) return;

  const idToKey = new Map<string, string>();
  for (const group of state.groups) {
    if (group.error) continue;
    for (const service of group.services) {
      const sk = statusKey(group.file, service);
      const st = state.statuses.get(sk);
      if (!st || st.state !== 'running' || !st.id) continue;
      idToKey.set(st.id, sk);
    }
  }

  const ids = [...idToKey.keys()];
  if (ids.length === 0) return;

  moduleState.statsPollActive = true;
  const child = fetchContainerStats(ids);
  let output = '';
  child.stdout!.on('data', (d: Buffer) => { output += d.toString(); });
  child.stderr!.on('data', () => {});
  child.on('close', () => {
    moduleState.statsPollActive = false;
    const bufferSize = state.config.statsBufferSize || 6;

    for (const line of output.trim().split('\n')) {
      if (!line.trim()) continue;
      const parsed = parseStatsLine(line);
      if (!parsed) continue;

      let sk: string | null = null;
      for (const [id, key] of idToKey) {
        if (parsed.id.startsWith(id) || id.startsWith(parsed.id)) {
          sk = key;
          break;
        }
      }
      if (!sk) continue;

      if (!state.containerStatsHistory.has(sk)) {
        state.containerStatsHistory.set(sk, { cpu: new Array(bufferSize).fill(0), mem: new Array(bufferSize).fill(0), idx: 0, count: 0 });
      }
      const hist = state.containerStatsHistory.get(sk)!;
      hist.cpu[hist.idx] = parsed.cpuPercent;
      hist.mem[hist.idx] = parsed.memUsageBytes;
      hist.idx = (hist.idx + 1) % bufferSize;
      hist.count = Math.min(hist.count + 1, bufferSize);

      let cpuSum = 0, memSum = 0;
      for (let i = 0; i < hist.count; i++) {
        cpuSum += hist.cpu[i];
        memSum += hist.mem[i];
      }
      state.containerStats.set(sk, {
        cpuPercent: cpuSum / hist.count,
        memUsageBytes: memSum / hist.count,
      });
    }

    if (state.mode === MODE.LIST) throttledRender(state);
  });
  child.on('error', () => {
    moduleState.statsPollActive = false;
  });
}

// --- Rendering ---

export function render(state: AppState): void {
  let view = '';
  if (state.mode === MODE.LIST) {
    view = renderListView(state);
  } else if (state.mode === MODE.LOGS) {
    view = renderLogView(state);
  } else if (state.mode === MODE.EXEC) {
    view = renderExecView(state);
  }
  // View functions already embed CLEAR_EOL per line; just clear below last line
  process.stdout.write(clearScreen() + view + CLEAR_EOL + CLEAR_EOS);
}

export function stripAnsi(str: string): string {
  return str.replace(
    // CSI sequences: \x1b[ ... letter
    // OSC sequences: \x1b] ... BEL  or  \x1b] ... ST
    // DCS/APC/PM/SOS sequences: \x1bP/\x1b_/\x1b^/\x1bX ... ST (where ST = \x1b\\)
    // Two-byte escape sequences: \x1b + any char
    /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P_^X][^\x1b]*(?:\x1b\\|\x07)|\x1b[^[\]P_^X]/g,
    ''
  );
}

export function throttledRender(state: AppState): void {
  const now = Date.now();
  const elapsed = now - moduleState.lastRenderTime;
  if (elapsed >= 150) {
    moduleState.lastRenderTime = now;
    render(state);
  } else if (!moduleState.pendingRender) {
    moduleState.pendingRender = setTimeout(() => {
      moduleState.pendingRender = null;
      moduleState.lastRenderTime = Date.now();
      render(state);
    }, 150 - elapsed);
  }
}

// --- Actions ---

export function updateSelectedLogs(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);

  if (state.selectedLogKey === sk) return;

  state.bottomSearchQuery = '';
  state.bottomSearchActive = false;
  clearBottomSearch(state);

  if (moduleState.logFetchTimer) {
    clearTimeout(moduleState.logFetchTimer);
    moduleState.logFetchTimer = null;
  }

  if (state.selectedLogKey) {
    const oldInfo = state.bottomLogLines.get(state.selectedLogKey);
    if (oldInfo && (oldInfo.action === 'logs' || oldInfo.action === 'started')) {
      if (!state.rebuilding.has(state.selectedLogKey) && !state.restarting.has(state.selectedLogKey)) {
        state.bottomLogLines.delete(state.selectedLogKey);
        if (state.bottomLogTails.has(state.selectedLogKey)) {
          state.bottomLogTails.get(state.selectedLogKey)!.kill('SIGTERM');
          state.bottomLogTails.delete(state.selectedLogKey);
        }
      }
    }
  }

  state.selectedLogKey = sk;

  if (state.bottomLogLines.has(sk)) return;

  state.bottomLogLines.set(sk, { action: 'logs', service: entry.service, lines: [] });

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
  moduleState.logFetchTimer = setTimeout(() => {
    moduleState.logFetchTimer = null;
    startBottomLogTail(state, sk, effectiveFile, entry.service);
  }, 500);
}

function startBottomLogTail(state: AppState, sk: string, file: string, service: string): void {
  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk)!.kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const containerId = getContainerId(file, service);
  if (!containerId) return;

  const maxLines = state.config.bottomLogCount || 10;
  const logChild = tailContainerLogs(containerId, maxLines);
  state.bottomLogTails.set(sk, logChild as Killable);

  let buf = '';
  const onData = (data: Buffer): void => {
    const info = state.bottomLogLines.get(sk);
    if (!info) return;
    buf += data.toString();
    const parts = buf.split(/\r?\n|\r/);
    buf = parts.pop()!;
    const newLines = parts.filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
    if (newLines.length === 0) return;
    info.lines.push(...newLines);
    if (info.lines.length > maxLines) info.lines = info.lines.slice(-maxLines);
    if (state.mode === MODE.LIST) throttledRender(state);
  };

  logChild.stdout!.on('data', onData);
  logChild.stderr!.on('data', onData);
}

export function doRebuild(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.rebuilding.has(sk)) return;

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);

  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk)!.kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const child = rebuildService(effectiveFile, entry.service, { noCache: state.noCache, noDeps: state.noDeps });
  state.rebuilding.set(sk, child as Killable);

  state.bottomLogLines.set(sk, { action: 'rebuilding', service: entry.service, lines: [] });

  let lineBuf = '';
  const onData = (data: Buffer): void => {
    const info = state.bottomLogLines.get(sk);
    if (!info) return;
    lineBuf += data.toString();
    const parts = lineBuf.split(/\r?\n|\r/);
    lineBuf = parts.pop()!;
    const newLines = parts.filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
    if (newLines.length === 0) return;
    info.lines.push(...newLines);
    if (state.mode === MODE.LOGS && state.logBuildKey === sk) {
      state.logLines.push(...newLines);
      if (state.logAutoScroll) throttledRender(state);
    }
    if (state.mode === MODE.LIST) throttledRender(state);
  };

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  render(state);

  child.on('close', (code: number | null) => {
    state.rebuilding.delete(sk);
    state.containerStatsHistory.delete(sk);
    state.containerStats.delete(sk);
    pollStatuses(state);

    const info = state.bottomLogLines.get(sk);
    if (code !== 0 && code !== null) {
      if (info) info.action = 'build_failed';
      if (state.mode === MODE.LIST) render(state);
      return;
    }

    if (info) {
      info.action = 'started';
      if (state.logBuildKey !== sk) info.lines = [];
    }

    startBottomLogTail(state, sk, effectiveFile, entry.service);
    if (state.mode === MODE.LIST) render(state);
  });
}

export function doRestart(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.restarting.has(sk) || state.rebuilding.has(sk)) return;

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);

  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk)!.kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const child = restartService(effectiveFile, entry.service);
  state.restarting.set(sk, child as Killable);

  state.bottomLogLines.set(sk, { action: 'restarting', service: entry.service, lines: [] });
  render(state);

  child.on('close', (code: number | null) => {
    state.restarting.delete(sk);
    state.containerStatsHistory.delete(sk);
    state.containerStats.delete(sk);
    pollStatuses(state);

    const info = state.bottomLogLines.get(sk);
    if (code !== 0 && code !== null) {
      if (info) info.action = 'restart_failed';
      if (state.mode === MODE.LIST) render(state);
      return;
    }

    if (info) {
      info.action = 'started';
      info.lines = [];
    }

    startBottomLogTail(state, sk, effectiveFile, entry.service);
    if (state.mode === MODE.LIST) render(state);
  });
}

export function doStop(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.stopping.has(sk) || state.rebuilding.has(sk) || state.restarting.has(sk)) return;

  const st = state.statuses.get(sk);
  if (!st || st.state !== 'running') return;

  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk)!.kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
  const child = stopService(effectiveFile, entry.service);
  state.stopping.set(sk, child as Killable);
  state.bottomLogLines.set(sk, { action: 'stopping', service: entry.service, lines: [] });
  render(state);

  child.on('close', (code: number | null) => {
    state.stopping.delete(sk);
    if (code !== 0 && code !== null) {
      const info = state.bottomLogLines.get(sk);
      if (info) info.action = 'stop_failed';
    } else {
      state.bottomLogLines.delete(sk);
    }
    pollStatuses(state);
    if (state.mode === MODE.LIST) render(state);
  });
}

export function doStart(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.starting.has(sk) || state.rebuilding.has(sk) || state.restarting.has(sk) || state.stopping.has(sk)) return;

  const st = state.statuses.get(sk);
  if (st && st.state === 'running') return;

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
  const child = startService(effectiveFile, entry.service);
  state.starting.set(sk, child as Killable);
  state.bottomLogLines.set(sk, { action: 'starting', service: entry.service, lines: [] });
  render(state);

  child.on('close', (code: number | null) => {
    state.starting.delete(sk);
    pollStatuses(state);

    const info = state.bottomLogLines.get(sk);
    if (code !== 0 && code !== null) {
      if (info) info.action = 'start_failed';
      if (state.mode === MODE.LIST) render(state);
      return;
    }

    if (info) {
      info.action = 'started';
      info.lines = [];
    }

    startBottomLogTail(state, sk, effectiveFile, entry.service);
    if (state.mode === MODE.LIST) render(state);
  });
}

// --- Worktree Switching ---

export function mapComposeFileToWorktree(composeFile: string, targetWorktreePath: string): string | null {
  const resolved = path.resolve(composeFile);
  const dir = path.dirname(resolved);
  const gitRoot = getGitRoot(dir);
  if (!gitRoot) return null;

  const relPath = path.relative(gitRoot, resolved);
  const newFile = path.join(targetWorktreePath, relPath);
  try {
    fs.accessSync(newFile);
    return newFile;
  } catch {
    return null;
  }
}

export function openWorktreePicker(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.rebuilding.has(sk) || state.restarting.has(sk) || state.stopping.has(sk) || state.starting.has(sk) || state.cascading.has(sk)) return;

  const composeDir = path.dirname(path.resolve(entry.file));
  const worktrees = listGitWorktrees(composeDir);

  if (worktrees.length <= 1) {
    state.bottomLogLines.set(sk, { action: 'switch_failed', service: entry.service, lines: ['no other worktrees available — use `git worktree add` to create one'] });
    state.showBottomLogs = true;
    render(state);
    return;
  }

  const gitRoot = getGitRoot(composeDir);

  state.worktreePickerEntries = worktrees;
  state.worktreePickerActive = true;
  state.worktreePickerCurrentPath = gitRoot;

  // Pre-select first non-current worktree
  const currentIdx = gitRoot ? worktrees.findIndex(w => w.path === gitRoot) : -1;
  const firstOther = worktrees.findIndex((_, i) => i !== currentIdx);
  state.worktreePickerCursor = firstOther >= 0 ? firstOther : 0;

  state.showBottomLogs = true;
  render(state);
}

export function doWorktreeSwitch(state: AppState, targetWorktree: GitWorktree): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const service = entry.service;
  const sk = statusKey(entry.file, service);

  // Close picker
  state.worktreePickerActive = false;
  state.worktreePickerEntries = [];
  state.worktreePickerCursor = 0;

  // Compute new file from the original group file
  const newFile = mapComposeFileToWorktree(entry.file, targetWorktree.path);
  if (!newFile) {
    state.bottomLogLines.set(sk, {
      action: 'switch_failed', service,
      lines: [`compose file not found in worktree "${targetWorktree.branch}" (${targetWorktree.path})`],
    });
    render(state);
    return;
  }

  // If target is the same as current effective file, nothing to do
  const currentEffective = getEffectiveFile(state, entry.file, service);
  if (newFile === currentEffective) {
    render(state);
    return;
  }

  // Validate service exists in target compose file
  if (!validateServiceInComposeFile(newFile, service)) {
    state.bottomLogLines.set(sk, {
      action: 'switch_failed', service,
      lines: [`service "${service}" not found in ${path.basename(newFile)} on branch "${targetWorktree.branch}"`],
    });
    render(state);
    return;
  }

  // Show switching progress
  state.bottomLogLines.set(sk, { action: 'switching', service, lines: [`switching to worktree "${targetWorktree.branch}"...`] });
  render(state);

  const performSwitch = (): void => {
    // Store the worktree override (or remove if switching back to original)
    if (newFile === entry.file) {
      state.worktreeOverrides.delete(sk);
    } else {
      state.worktreeOverrides.set(sk, newFile);
    }

    // Update bottomLogLines to show rebuild
    state.bottomLogLines.set(sk, { action: 'switching', service, lines: [`rebuilding in worktree "${targetWorktree.branch}"...`] });

    // Rebuild in new worktree
    const child = rebuildService(newFile, service, { noCache: state.noCache, noDeps: state.noDeps });
    state.rebuilding.set(sk, child as Killable);

    let lineBuf = '';
    const onData = (data: Buffer): void => {
      const info = state.bottomLogLines.get(sk);
      if (!info) return;
      lineBuf += data.toString();
      const parts = lineBuf.split(/\r?\n|\r/);
      lineBuf = parts.pop()!;
      const newLines = parts.filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
      if (newLines.length === 0) return;
      info.lines.push(...newLines);
      if (state.mode === MODE.LIST) throttledRender(state);
    };

    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    render(state);

    child.on('close', (code: number | null) => {
      state.rebuilding.delete(sk);
      state.containerStatsHistory.delete(sk);
      state.containerStats.delete(sk);
      pollStatuses(state);

      const info = state.bottomLogLines.get(sk);
      if (code !== 0 && code !== null) {
        if (info) info.action = 'build_failed';
        if (state.mode === MODE.LIST) render(state);
        return;
      }

      if (info) {
        info.action = 'started';
        info.lines = [];
      }

      startBottomLogTail(state, sk, newFile, service);
      if (state.mode === MODE.LIST) render(state);
    });
  };

  // If service is running, stop it first (using current effective file)
  const st = state.statuses.get(sk);
  if (st && st.state === 'running') {
    if (state.bottomLogTails.has(sk)) {
      state.bottomLogTails.get(sk)!.kill('SIGTERM');
      state.bottomLogTails.delete(sk);
    }
    const stopChild = stopService(currentEffective, service);
    state.stopping.set(sk, stopChild as Killable);
    render(state);

    stopChild.on('close', () => {
      state.stopping.delete(sk);
      performSwitch();
    });
  } else {
    performSwitch();
  }
}

// --- Watch ---

export function doWatch(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);

  // Toggle off if already watching
  if (state.watching.has(sk)) {
    state.watching.get(sk)!.kill('SIGTERM');
    state.watching.delete(sk);
    const info = state.bottomLogLines.get(sk);
    if (info && info.action === 'watching') {
      state.bottomLogLines.delete(sk);
    }
    render(state);
    return;
  }

  // Check availability on first use
  if (state.watchAvailable === null) {
    state.watchAvailable = isWatchAvailable();
  }
  if (!state.watchAvailable) {
    state.bottomLogLines.set(sk, { action: 'watching', service: entry.service, lines: ['docker compose watch is not available (requires Docker Compose v2.22+)'] });
    state.showBottomLogs = true;
    render(state);
    return;
  }

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
  const child = watchService(effectiveFile, entry.service);
  state.watching.set(sk, child as Killable);
  state.bottomLogLines.set(sk, { action: 'watching', service: entry.service, lines: [] });
  state.showBottomLogs = true;

  let lineBuf = '';
  const maxLines = state.config.bottomLogCount || 10;
  const onData = (data: Buffer): void => {
    const info = state.bottomLogLines.get(sk);
    if (!info) return;
    lineBuf += data.toString();
    const parts = lineBuf.split(/\r?\n|\r/);
    lineBuf = parts.pop()!;
    const newLines = parts.filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
    if (newLines.length === 0) return;
    info.lines.push(...newLines);
    if (info.lines.length > maxLines) info.lines = info.lines.slice(-maxLines);
    if (state.mode === MODE.LIST) throttledRender(state);
  };

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  child.on('close', () => {
    state.watching.delete(sk);
    if (state.mode === MODE.LIST) render(state);
  });

  render(state);
}

// --- Dependency-Aware Rebuild ---

export function initDepGraphs(state: AppState): void {
  for (const group of state.groups) {
    if (group.error) continue;
    try {
      state.depGraphs.set(group.file, parseDependencyGraph(group.file));
    } catch {
      // Ignore — no dep info for this file
    }
  }
}

function getTransitiveDependents(graph: { dependedBy: Map<string, string[]> }, service: string): string[] {
  const visited = new Set<string>();
  const queue = [service];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const deps = graph.dependedBy.get(current) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...visited];
}

function topoSortDependents(graph: { dependsOn: Map<string, string[]> }, services: string[], root: string): string[] {
  // Topological sort of the dependent services, so prerequisites come first
  const serviceSet = new Set(services);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const svc of services) {
    inDegree.set(svc, 0);
    adj.set(svc, []);
  }

  for (const svc of services) {
    const deps = (graph.dependsOn.get(svc) || []).filter(d => serviceSet.has(d) || d === root);
    for (const dep of deps) {
      if (serviceSet.has(dep)) {
        adj.get(dep)!.push(svc);
        inDegree.set(svc, (inDegree.get(svc) || 0) + 1);
      }
    }
  }

  const sorted: string[] = [];
  const queue = services.filter(s => (inDegree.get(s) || 0) === 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of (adj.get(current) || [])) {
      const deg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}

export function doCascadeRebuild(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.rebuilding.has(sk) || state.cascading.has(sk)) return;

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
  let graph = state.depGraphs.get(effectiveFile);
  if (!graph) {
    // Try to parse dep graph for the effective file (may differ from original)
    try {
      graph = parseDependencyGraph(effectiveFile);
      state.depGraphs.set(effectiveFile, graph);
    } catch {
      // No graph available, fall back to regular rebuild
      doRebuild(state);
      return;
    }
  }
  if (!graph) {
    doRebuild(state);
    return;
  }

  const dependents = getTransitiveDependents(graph, entry.service);
  if (dependents.length === 0) {
    // No dependents, fall back to regular rebuild
    doRebuild(state);
    return;
  }

  const sorted = topoSortDependents(graph, dependents, entry.service);

  const steps: CascadeStep[] = [
    { action: 'rebuild', service: entry.service, status: 'pending' },
    ...sorted.map(svc => ({ action: 'restart' as const, service: svc, status: 'pending' as const })),
  ];

  const cascade: CascadeOperation = { steps, currentStepIdx: 0, child: null };
  state.cascading.set(sk, cascade);

  state.bottomLogLines.set(sk, { action: 'cascading', service: entry.service, lines: [] });
  state.showBottomLogs = true;

  executeCascadeStep(state, effectiveFile, sk, cascade);
  render(state);
}

function executeCascadeStep(state: AppState, file: string, sk: string, cascade: CascadeOperation): void {
  const step = cascade.steps[cascade.currentStepIdx];
  if (!step) {
    // All done
    state.cascading.delete(sk);
    pollStatuses(state);
    if (state.mode === MODE.LIST) render(state);
    return;
  }

  step.status = 'in_progress';

  let child: ChildProcess | Killable;
  if (step.action === 'rebuild') {
    child = rebuildService(file, step.service, { noCache: state.noCache, noDeps: state.noDeps });
  } else {
    child = restartService(file, step.service);
  }
  cascade.child = child as ChildProcess;

  let lineBuf = '';
  const onData = (data: Buffer): void => {
    const info = state.bottomLogLines.get(sk);
    if (!info) return;
    lineBuf += data.toString();
    const parts = lineBuf.split(/\r?\n|\r/);
    lineBuf = parts.pop()!;
    const newLines = parts.filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
    if (newLines.length === 0) return;
    info.lines.push(...newLines);
    if (state.mode === MODE.LOGS && state.logBuildKey === sk) {
      state.logLines.push(...newLines);
      if (state.logAutoScroll) throttledRender(state);
    }
    if (state.mode === MODE.LIST) throttledRender(state);
  };

  const childProcess = child as { stdout: { on: Function }; stderr: { on: Function }; on: Function };
  childProcess.stdout.on('data', onData);
  childProcess.stderr.on('data', onData);
  childProcess.on('close', (code: number | null) => {
    if (code !== 0 && code !== null) {
      step.status = 'failed';
      state.cascading.delete(sk);
      pollStatuses(state);
      if (state.mode === MODE.LIST) render(state);
      return;
    }

    step.status = 'completed';
    cascade.currentStepIdx++;
    cascade.child = null;

    // Reset stats for rebuilt/restarted service
    const stepSk = statusKey(file, step.service);
    state.containerStatsHistory.delete(stepSk);
    state.containerStats.delete(stepSk);

    if (cascade.currentStepIdx < cascade.steps.length) {
      executeCascadeStep(state, file, sk, cascade);
    } else {
      state.cascading.delete(sk);
      pollStatuses(state);
      const info = state.bottomLogLines.get(sk);
      if (info) {
        info.action = 'started';
        info.lines = [];
      }
      startBottomLogTail(state, sk, file, state.flatList[state.cursor]?.service || '');
    }
    if (state.mode === MODE.LIST) render(state);
  });
}

// --- Exec ---

function initExecState(state: AppState): boolean {
  const entry = selectedEntry(state);
  if (!entry) return false;

  const sk = statusKey(entry.file, entry.service);
  const st = state.statuses.get(sk);
  if (!st || st.state !== 'running' || !st.id) return false;

  state.execInput = '';
  state.execOutputLines = [];
  state.execHistoryIdx = -1;
  state.execContainerId = st.id;
  state.execService = entry.service;
  state.execChild = null;
  state.execCwd = null;
  return true;
}

export function enterExecInline(state: AppState): void {
  if (!initExecState(state)) return;
  state.execActive = true;
  state.showBottomLogs = true;
  render(state);
}

export function enterExec(state: AppState): void {
  if (!state.execActive) {
    if (!initExecState(state)) return;
  }
  state.execActive = false;
  state.mode = MODE.EXEC;
  render(state);
}

export function exitExec(state: AppState): void {
  if (state.execChild) {
    state.execChild.kill('SIGTERM');
    state.execChild = null;
  }
  const wasFullscreen = state.mode === MODE.EXEC;
  state.mode = MODE.LIST;
  state.execActive = false;
  state.execInput = '';
  state.execOutputLines = [];
  state.execHistoryIdx = -1;
  state.execContainerId = null;
  state.execService = null;
  state.execCwd = null;
  if (wasFullscreen) pollStatuses(state);
  render(state);
}

function isCdCommand(cmd: string): string | null {
  const match = cmd.match(/^cd(\s+(.*))?$/);
  if (!match) return null;
  return match[2] ? match[2].trim() : '';
}

export function shellEscape(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

export function runExecCommand(state: AppState): void {
  const cmd = state.execInput.trim();
  if (!cmd || !state.execContainerId) return;

  // Add to history (capped at 1000 entries)
  if (state.execHistory.length === 0 || state.execHistory[state.execHistory.length - 1] !== cmd) {
    state.execHistory.push(cmd);
    if (state.execHistory.length > 1000) state.execHistory.shift();
  }
  state.execHistoryIdx = -1;
  state.execInput = '';

  // Kill previous exec if still running
  if (state.execChild) {
    state.execChild.kill('SIGTERM');
    state.execChild = null;
  }

  state.execOutputLines.push(`$ ${cmd}`);

  // Handle cd commands — resolve new working directory
  const cdTarget = isCdCommand(cmd);
  if (cdTarget !== null) {
    const resolveCmd = cdTarget ? `cd ${shellEscape(cdTarget)} && pwd` : 'cd && pwd';
    const child = execInContainer(state.execContainerId, resolveCmd, state.execCwd || undefined);
    state.execChild = child;

    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr!.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null) => {
      if (state.execChild === child) state.execChild = null;
      if (code === 0) {
        const lines = stdout.trim().split('\n');
        const newCwd = lines[lines.length - 1].trim();
        if (newCwd && newCwd.startsWith('/') && newCwd.length < 4096 && !/[\x00-\x1f]/.test(newCwd)) {
          state.execCwd = newCwd;
        }
      } else {
        const errLines = stderr.trim().split('\n').filter(Boolean);
        for (const line of errLines) {
          state.execOutputLines.push(stripAnsi(line));
        }
      }
      if (state.mode === MODE.EXEC || state.execActive) throttledRender(state);
    });
    render(state);
    return;
  }

  const child = execInContainer(state.execContainerId, cmd, state.execCwd || undefined);
  state.execChild = child;

  let lineBuf = '';
  const onData = (data: Buffer): void => {
    lineBuf += data.toString();
    const parts = lineBuf.split(/\r?\n|\r/);
    lineBuf = parts.pop()!;
    const newLines = parts.filter(l => l.length > 0).map(stripAnsi).filter(Boolean);
    if (newLines.length === 0) return;
    state.execOutputLines.push(...newLines);
    if (state.execOutputLines.length > 200) {
      state.execOutputLines = state.execOutputLines.slice(-200);
    }
    if (state.mode === MODE.EXEC || state.execActive) throttledRender(state);
  };

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  child.on('close', () => {
    if (state.execChild === child) {
      state.execChild = null;
    }
    // Flush remaining buffer
    if (lineBuf.trim()) {
      state.execOutputLines.push(stripAnsi(lineBuf));
      lineBuf = '';
    }
    if (state.mode === MODE.EXEC || state.execActive) throttledRender(state);
  });

  render(state);
}

export function enterLogs(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  if (moduleState.logFetchTimer) {
    clearTimeout(moduleState.logFetchTimer);
    moduleState.logFetchTimer = null;
  }

  // Carry over bottom panel search query to full log search
  const carryQuery = state.bottomSearchQuery || '';
  clearBottomSearch(state);

  const sk = statusKey(entry.file, entry.service);
  const info = state.bottomLogLines.get(sk);
  const isBuilding = state.rebuilding.has(sk) || state.cascading.has(sk);
  const isBuildFailed = info && info.action === 'build_failed';

  state.mode = MODE.LOGS;
  state.logLines = [];
  state.logScrollOffset = 0;
  state.logAutoScroll = true;
  state.logSearchQuery = carryQuery;
  state.logSearchActive = false;
  state.logSearchMatches = [];
  state.logSearchMatchIdx = -1;
  state.logFetchedTailCount = 200;
  state.logHistoryLoaded = false;
  state.logHistoryLoading = false;
  state.logSearchPending = !!carryQuery;
  state.logHistoryChild = null;

  if (isBuilding || isBuildFailed) {
    // Show build output instead of runtime logs
    state.logBuildKey = sk;
    if (info) {
      state.logLines = [...info.lines];
    }
    state.logHistoryLoaded = true;
  } else {
    state.logBuildKey = null;

    const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
    const child = tailLogs(effectiveFile, entry.service, 200);
    state.logChild = child;

    let lineBuf = '';
    const onData = (data: Buffer): void => {
      lineBuf += data.toString();
      const parts = lineBuf.split(/\r?\n|\r/);
      lineBuf = parts.pop()!;
      if (parts.length === 0) return;
      for (const line of parts) {
        state.logLines.push(stripAnsi(line));
      }
      if (state.logAutoScroll) {
        throttledRender(state);
      }
    };

    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('close', () => {
      if (state.logChild === child) {
        state.logChild = null;
      }
    });

    // If carrying a search query from bottom panel, load full history to search
    if (carryQuery) {
      state.logFetchedTailCount = 5000;
      loadMoreLogHistory(state);
    }
  }

  render(state);
}

export function exitLogs(state: AppState): void {
  if (state.logChild) {
    state.logChild.kill('SIGTERM');
    state.logChild = null;
  }
  if (state.logHistoryChild) {
    state.logHistoryChild.kill('SIGTERM');
    state.logHistoryChild = null;
  }
  state.logLines = [];
  state.logBuildKey = null;
  state.logHistoryLoaded = false;
  state.logHistoryLoading = false;
  state.logSearchPending = false;
  state.mode = MODE.LIST;
  pollStatuses(state);
  render(state);
}

// --- Log History Loading ---

export function loadMoreLogHistory(state: AppState): void {
  if (state.logHistoryLoaded || state.logHistoryLoading) return;

  const entry = selectedEntry(state);
  if (!entry) return;

  // Escalate: 200 → 1000 → 5000 → all
  let nextTail: number | 'all';
  if (state.logFetchedTailCount < 1000) nextTail = 1000;
  else if (state.logFetchedTailCount < 5000) nextTail = 5000;
  else nextTail = 'all';

  state.logHistoryLoading = true;
  const snapshotLen = state.logLines.length;

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
  const child = fetchServiceLogs(effectiveFile, entry.service, nextTail);
  state.logHistoryChild = child;

  let output = '';
  child.stdout!.on('data', (d: Buffer) => { output += d.toString(); });
  child.stderr!.on('data', (d: Buffer) => { output += d.toString(); });
  child.on('close', () => {
    if (state.logHistoryChild === child) {
      state.logHistoryChild = null;
    }
    state.logHistoryLoading = false;

    const fetchedLines = output.split(/\r?\n|\r/).filter(l => l.length > 0).map(stripAnsi).filter(Boolean);
    if (fetchedLines.length <= snapshotLen) {
      // No more history available
      state.logHistoryLoaded = true;
    } else {
      // Merge: fetched history + any new lines that arrived during the fetch
      const newLiveLines = state.logLines.slice(snapshotLen);
      const oldOffset = state.logScrollOffset;
      const added = fetchedLines.length - snapshotLen;
      state.logLines = [...fetchedLines, ...newLiveLines];
      // Adjust scroll offset to maintain visual position
      if (!state.logAutoScroll) {
        state.logScrollOffset = oldOffset + added;
      }
      state.logFetchedTailCount = nextTail === 'all' ? Infinity : nextTail;
      if (nextTail === 'all') state.logHistoryLoaded = true;
    }

    if (state.logSearchPending) {
      state.logSearchPending = false;
      executeLogSearch(state);
    }

    render(state);
  });
}

// --- Log Search ---

export function executeLogSearch(state: AppState): void {
  const query = state.logSearchQuery;
  state.logSearchMatches = [];
  state.logSearchMatchIdx = -1;
  if (!query) return;

  const lowerQuery = query.toLowerCase();
  for (let i = 0; i < state.logLines.length; i++) {
    if (state.logLines[i].toLowerCase().includes(lowerQuery)) {
      state.logSearchMatches.push(i);
    }
  }

  if (state.logSearchMatches.length > 0) {
    state.logSearchMatchIdx = 0;
    scrollToLogLine(state, state.logSearchMatches[0]);
  }
}

function scrollToLogLine(state: AppState, lineIdx: number): void {
  const rows = process.stdout.rows ?? 24;
  const headerHeight = 9;
  const availableRows = Math.max(1, rows - headerHeight);
  const totalLines = state.logLines.length;
  const maxOffset = Math.max(0, totalLines - availableRows);

  state.logScrollOffset = Math.min(maxOffset, Math.max(0, totalLines - lineIdx - Math.floor(availableRows / 2)));
  state.logAutoScroll = state.logScrollOffset === 0;
  render(state);
}

export function jumpToNextMatch(state: AppState): void {
  if (state.logSearchMatches.length === 0) return;
  state.logSearchMatchIdx = (state.logSearchMatchIdx + 1) % state.logSearchMatches.length;
  scrollToLogLine(state, state.logSearchMatches[state.logSearchMatchIdx]);
}

export function jumpToPrevMatch(state: AppState): void {
  if (state.logSearchMatches.length === 0) return;
  state.logSearchMatchIdx = (state.logSearchMatchIdx - 1 + state.logSearchMatches.length) % state.logSearchMatches.length;
  scrollToLogLine(state, state.logSearchMatches[state.logSearchMatchIdx]);
}

// --- Bottom Panel Search ---

export function executeBottomSearch(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry || !state.bottomSearchQuery) return;

  const sk = statusKey(entry.file, entry.service);
  const info = state.bottomLogLines.get(sk);
  if (!info) return;

  // Save current tail lines so we can restore them later
  if (!state.bottomSearchSavedLines.has(sk)) {
    state.bottomSearchSavedLines.set(sk, [...info.lines]);
  }

  // Kill any previous search fetch
  if (state.bottomSearchChild) {
    state.bottomSearchChild.kill('SIGTERM');
    state.bottomSearchChild = null;
  }

  state.bottomSearchLoading = true;
  state.bottomSearchTotalMatches = 0;
  render(state);

  const effectiveFile = getEffectiveFile(state, entry.file, entry.service);
  const child = fetchServiceLogs(effectiveFile, entry.service, 'all');
  state.bottomSearchChild = child;

  let output = '';
  child.stdout!.on('data', (d: Buffer) => { output += d.toString(); });
  child.stderr!.on('data', (d: Buffer) => { output += d.toString(); });
  child.on('close', () => {
    if (state.bottomSearchChild !== child) return; // superseded
    state.bottomSearchChild = null;
    state.bottomSearchLoading = false;

    const query = state.bottomSearchQuery;
    if (!query) { clearBottomSearch(state); render(state); return; }

    const lowerQuery = query.toLowerCase();
    const allLines = output.split(/\r?\n|\r/).filter(l => l.trim().length > 0).map(stripAnsi).filter(Boolean);
    const matchingLines: string[] = [];
    for (const line of allLines) {
      if (line.toLowerCase().includes(lowerQuery)) {
        matchingLines.push(line);
      }
    }

    state.bottomSearchTotalMatches = matchingLines.length;

    // Show the last N matching lines in the bottom panel
    const maxLines = state.config.bottomLogCount || 10;
    const currentInfo = state.bottomLogLines.get(sk);
    if (currentInfo) {
      currentInfo.lines = matchingLines.slice(-maxLines);
    }

    if (state.mode === MODE.LIST) render(state);
  });
}

export function clearBottomSearch(state: AppState): void {
  if (state.bottomSearchChild) {
    state.bottomSearchChild.kill('SIGTERM');
    state.bottomSearchChild = null;
  }
  state.bottomSearchLoading = false;
  state.bottomSearchTotalMatches = 0;

  // Restore saved tail lines
  if (state.selectedLogKey && state.bottomSearchSavedLines.has(state.selectedLogKey)) {
    const info = state.bottomLogLines.get(state.selectedLogKey);
    if (info) {
      info.lines = state.bottomSearchSavedLines.get(state.selectedLogKey)!;
    }
    state.bottomSearchSavedLines.delete(state.selectedLogKey);
  }
}

// --- Input Handling ---

export function handleKeypress(state: AppState, key: string): void {
  if (key === '\x03' && state.mode !== MODE.EXEC && !state.execActive) {
    cleanup(state);
    process.exit(0);
  }

  if (state.mode === MODE.EXEC) {
    if (key === '\x1b') {
      exitExec(state);
    } else if (key === '\r') {
      runExecCommand(state);
    } else if (key === '\x7f' || key === '\b') {
      state.execInput = state.execInput.slice(0, -1);
      render(state);
    } else if (key === '\x1b[A') {
      // Up arrow — history navigation
      if (state.execHistory.length > 0) {
        if (state.execHistoryIdx === -1) {
          state.execHistoryIdx = state.execHistory.length - 1;
        } else if (state.execHistoryIdx > 0) {
          state.execHistoryIdx--;
        }
        state.execInput = state.execHistory[state.execHistoryIdx] || '';
        render(state);
      }
    } else if (key === '\x1b[B') {
      // Down arrow — history navigation
      if (state.execHistoryIdx !== -1) {
        if (state.execHistoryIdx < state.execHistory.length - 1) {
          state.execHistoryIdx++;
          state.execInput = state.execHistory[state.execHistoryIdx] || '';
        } else {
          state.execHistoryIdx = -1;
          state.execInput = '';
        }
        render(state);
      }
    } else if (key === '\x03') {
      // Ctrl+C — kill current exec child
      if (state.execChild) {
        state.execChild.kill('SIGTERM');
        state.execChild = null;
        state.execOutputLines.push('^C');
        render(state);
      } else {
        cleanup(state);
        process.exit(0);
      }
    } else if (key.length === 1 && key >= ' ') {
      state.execInput += key;
      render(state);
    }
    return;
  }

  if (state.mode === MODE.LOGS) {
    if (state.logSearchActive) {
      if (key === '\x1b') {
        state.logSearchActive = false;
        state.logSearchQuery = '';
        render(state);
      } else if (key === '\r') {
        state.logSearchActive = false;
        if (!state.logHistoryLoaded && !state.logHistoryLoading) {
          // Load all history, then search
          state.logSearchPending = true;
          state.logFetchedTailCount = 5000; // jump straight to 'all'
          loadMoreLogHistory(state);
          render(state);
        } else if (state.logHistoryLoading) {
          // Already loading — search will run when it finishes
          state.logSearchPending = true;
          render(state);
        } else {
          executeLogSearch(state);
          render(state);
        }
      } else if (key === '\x7f' || key === '\b') {
        state.logSearchQuery = state.logSearchQuery.slice(0, -1);
        render(state);
      } else if (key.length === 1 && key >= ' ') {
        state.logSearchQuery += key;
        render(state);
      }
      return;
    }

    const rows = process.stdout.rows ?? 24;
    const pageSize = Math.max(1, Math.floor(rows / 2));
    const availableRows = Math.max(1, rows - 9);
    const maxOffset = Math.max(0, state.logLines.length - availableRows);

    // Trigger lazy history load when scrolled near the top
    const checkLoadMore = (): void => {
      const availableRows = Math.max(1, rows - 9);
      const linesFromTop = state.logLines.length - state.logScrollOffset - availableRows;
      if (linesFromTop < availableRows) {
        loadMoreLogHistory(state);
      }
    };

    switch (key) {
      case 'f':
        exitLogs(state);
        break;
      case '\x1b':
        if (state.logSearchQuery) {
          state.logSearchQuery = '';
          state.logSearchMatches = [];
          state.logSearchMatchIdx = -1;
          render(state);
        } else {
          exitLogs(state);
        }
        break;
      case 'q':
        cleanup(state);
        process.exit(0);
        break;
      case 'k':
      case '\x1b[A':
        state.logAutoScroll = false;
        state.logScrollOffset = Math.min(maxOffset, state.logScrollOffset + 1);
        checkLoadMore();
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
      case '\x15': // Ctrl+U
        state.logAutoScroll = false;
        state.logScrollOffset = Math.min(maxOffset, state.logScrollOffset + pageSize);
        checkLoadMore();
        render(state);
        break;
      case '\x04': // Ctrl+D
        state.logScrollOffset = Math.max(0, state.logScrollOffset - pageSize);
        if (state.logScrollOffset === 0) state.logAutoScroll = true;
        render(state);
        break;
      case '/':
        state.logSearchActive = true;
        state.logSearchQuery = '';
        render(state);
        break;
      case 'n':
        jumpToNextMatch(state);
        break;
      case 'N':
        jumpToPrevMatch(state);
        break;
    }
    return;
  }

  // LIST mode - worktree picker
  if (state.worktreePickerActive) {
    if (key === '\x1b') {
      state.worktreePickerActive = false;
      state.worktreePickerEntries = [];
      state.worktreePickerCursor = 0;
      state.worktreePickerCurrentPath = null;
      render(state);
    } else if (key === '\r') {
      const target = state.worktreePickerEntries[state.worktreePickerCursor];
      if (target) doWorktreeSwitch(state, target);
    } else if (key === 'j' || key === '\x1b[B') {
      state.worktreePickerCursor = Math.min(state.worktreePickerEntries.length - 1, state.worktreePickerCursor + 1);
      render(state);
    } else if (key === 'k' || key === '\x1b[A') {
      state.worktreePickerCursor = Math.max(0, state.worktreePickerCursor - 1);
      render(state);
    } else if (key === 'G') {
      state.worktreePickerCursor = state.worktreePickerEntries.length - 1;
      render(state);
    }
    return;
  }

  // LIST mode - inline exec input
  if (state.execActive) {
    if (key === '\x1b') {
      exitExec(state);
    } else if (key === '\r') {
      runExecCommand(state);
    } else if (key === '\x7f' || key === '\b') {
      state.execInput = state.execInput.slice(0, -1);
      render(state);
    } else if (key === '\x1b[A') {
      if (state.execHistory.length > 0) {
        if (state.execHistoryIdx === -1) {
          state.execHistoryIdx = state.execHistory.length - 1;
        } else if (state.execHistoryIdx > 0) {
          state.execHistoryIdx--;
        }
        state.execInput = state.execHistory[state.execHistoryIdx] || '';
        render(state);
      }
    } else if (key === '\x1b[B') {
      if (state.execHistoryIdx !== -1) {
        if (state.execHistoryIdx < state.execHistory.length - 1) {
          state.execHistoryIdx++;
          state.execInput = state.execHistory[state.execHistoryIdx] || '';
        } else {
          state.execHistoryIdx = -1;
          state.execInput = '';
        }
        render(state);
      }
    } else if (key === '\x03') {
      if (state.execChild) {
        state.execChild.kill('SIGTERM');
        state.execChild = null;
        state.execOutputLines.push('^C');
        render(state);
      } else {
        cleanup(state);
        process.exit(0);
      }
    } else if (key === 'x') {
      enterExec(state);
    } else if (key.length === 1 && key >= ' ') {
      state.execInput += key;
      render(state);
    }
    return;
  }

  // LIST mode - bottom panel search input
  if (state.bottomSearchActive) {
    if (key === '\x1b') {
      state.bottomSearchActive = false;
      state.bottomSearchQuery = '';
      clearBottomSearch(state);
      render(state);
    } else if (key === '\r') {
      state.bottomSearchActive = false;
      if (state.bottomSearchQuery) {
        executeBottomSearch(state);
      }
      render(state);
    } else if (key === '\x7f' || key === '\b') {
      state.bottomSearchQuery = state.bottomSearchQuery.slice(0, -1);
      render(state);
    } else if (key.length === 1 && key >= ' ') {
      state.bottomSearchQuery += key;
      render(state);
    }
    return;
  }

  // LIST mode
  switch (key) {
    case 'j':
    case '\x1b[B':
      moveCursor(state, 1);
      updateSelectedLogs(state);
      render(state);
      break;
    case 'k':
    case '\x1b[A':
      moveCursor(state, -1);
      updateSelectedLogs(state);
      render(state);
      break;
    case 'b':
      doRebuild(state);
      break;
    case 'd':
      doCascadeRebuild(state);
      break;
    case 'w':
      doWatch(state);
      break;
    case 'e':
      enterExecInline(state);
      break;
    case 'x':
      enterExec(state);
      break;
    case 's': {
      const sEntry = selectedEntry(state);
      if (sEntry) {
        const sSk = statusKey(sEntry.file, sEntry.service);
        const sSt = state.statuses.get(sSk);
        if (sSt && sSt.state === 'running') {
          doRestart(state);
        } else {
          doStart(state);
        }
      }
      break;
    }
    case 'p':
      doStop(state);
      break;
    case 'n':
      state.noCache = !state.noCache;
      render(state);
      break;
    case 'o':
      state.noDeps = !state.noDeps;
      render(state);
      break;
    case 'f':
    case '\r':
      enterLogs(state);
      break;
    case 'l':
      state.showBottomLogs = !state.showBottomLogs;
      render(state);
      break;
    case 't':
      openWorktreePicker(state);
      break;
    case 'q':
      cleanup(state);
      process.exit(0);
      break;
    case 'G':
      state.cursor = state.flatList.length - 1;
      updateSelectedLogs(state);
      render(state);
      break;
    case 'g':
      break;
    case '/':
      if (state.showBottomLogs) {
        state.bottomSearchActive = true;
        state.bottomSearchQuery = '';
        render(state);
      }
      break;
  }
}

// --- Arrow key sequence buffering ---

export function createInputHandler(state: AppState): (data: Buffer | string) => void {
  let buf = '';
  let gPending = false;

  return function onData(data: Buffer | string): void {
    const str = data.toString();

    buf += str;

    while (buf.length > 0) {
      if (buf === '\x1b') {
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
        buf = buf.slice(buf.length);
        continue;
      }

      const ch = buf[0];
      buf = buf.slice(1);

      if (state.logSearchActive || state.bottomSearchActive || state.worktreePickerActive || state.mode === MODE.EXEC || state.execActive) {
        handleKeypress(state, ch);
        continue;
      }

      if (ch === 'g') {
        if (gPending) {
          gPending = false;
          if (state.mode === MODE.LIST) {
            state.cursor = 0;
            state.scrollOffset = 0;
            updateSelectedLogs(state);
          } else if (state.mode === MODE.LOGS) {
            state.logAutoScroll = false;
            const ggRows = process.stdout.rows ?? 24;
            const ggAvailable = Math.max(1, ggRows - 9);
            state.logScrollOffset = Math.max(0, state.logLines.length - ggAvailable);
            // Load all history so we can scroll to the very top
            if (!state.logHistoryLoaded) {
              state.logFetchedTailCount = 5000; // jump to 'all'
              loadMoreLogHistory(state);
            }
          }
          render(state);
          continue;
        }
        gPending = true;
        setTimeout(() => {
          if (gPending) {
            gPending = false;
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

export function cleanup(state: AppState): void {
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
  for (const [, child] of state.stopping) {
    child.kill('SIGTERM');
  }
  state.stopping.clear();
  for (const [, child] of state.starting) {
    child.kill('SIGTERM');
  }
  state.starting.clear();
  for (const [, child] of state.watching) {
    child.kill('SIGTERM');
  }
  state.watching.clear();
  for (const [, cascade] of state.cascading) {
    if (cascade.child) cascade.child.kill('SIGTERM');
  }
  state.cascading.clear();
  if (state.execChild) {
    state.execChild.kill('SIGTERM');
    state.execChild = null;
  }
  state.execActive = false;
  if (state.bottomSearchChild) {
    state.bottomSearchChild.kill('SIGTERM');
    state.bottomSearchChild = null;
  }
  for (const [, child] of state.bottomLogTails) {
    child.kill('SIGTERM');
  }
  state.bottomLogTails.clear();
  if (moduleState.logFetchTimer) {
    clearTimeout(moduleState.logFetchTimer);
    moduleState.logFetchTimer = null;
  }
  if (moduleState.pendingRender) {
    clearTimeout(moduleState.pendingRender);
    moduleState.pendingRender = null;
  }
  if (state.logScanTimer) {
    clearInterval(state.logScanTimer);
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  if (state.statsTimer) {
    clearInterval(state.statsTimer);
  }
  process.stdout.write('\x1b[r' + showCursor() + '\x1b[0m\x1b[?1049l');
}

// Expose for testing
export function _getModuleState(): ModuleState {
  return moduleState;
}

export function _setModuleState(ms: ModuleState): void {
  moduleState = ms;
}

// --- Main ---

function main(): void {
  // Enter alternate screen buffer so pre-launch output (e.g. npx install) is hidden
  process.stdout.write('\x1b[?1049h');
  const config = loadConfig();
  const state = createState(config);

  state.groups = discoverServices(config);
  state.flatList = buildFlatList(state.groups);

  if (state.flatList.length === 0) {
    process.stderr.write('No services found in any compose file.\n');
    process.exit(1);
  }

  pollStatuses(state);
  initDepGraphs(state);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', createInputHandler(state));

  pollLogCounts(state);

  updateSelectedLogs(state);
  render(state);

  state.pollTimer = setInterval(() => {
    if (state.mode === MODE.LIST) {
      pollStatuses(state);
      render(state);
    }
  }, config.pollInterval);

  state.logScanTimer = setInterval(() => {
    if (state.mode === MODE.LIST) {
      pollLogCounts(state);
    }
  }, config.logScanInterval || 10000);

  pollContainerStats(state);
  state.statsTimer = setInterval(() => {
    if (state.mode === MODE.LIST) {
      pollContainerStats(state);
    }
  }, config.statsInterval || 5000);

  process.stdout.on('resize', () => {
    render(state);
  });

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

// Only run main when executed directly (not when imported for testing)
if (require.main === module) {
  main();
}
