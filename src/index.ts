#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import type { ChildProcess } from 'child_process';
import { listServices, getStatuses, rebuildService, restartService, stopService, startService, tailLogs, getContainerId, tailContainerLogs, fetchContainerLogs, fetchContainerStats, parseStatsLine, isWatchAvailable, watchService, parseDependencyGraph, execInContainer } from './lib/docker';
import { MODE, createState, statusKey, buildFlatList, moveCursor, selectedEntry } from './lib/state';
import { clearScreen, showCursor, renderListView, renderLogView, renderExecView } from './lib/renderer';
import type { Config, AppState, ServiceGroup, Killable, StatsHistory, CascadeStep, CascadeOperation } from './lib/types';

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
    logScanPatterns: ['WRN]', 'ERR]'],
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
    Object.assign(defaults, JSON.parse(fs.readFileSync(configPath, 'utf8')));
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
  for (const group of state.groups) {
    if (group.error) continue;
    const statuses = getStatuses(group.file);
    for (const [svc, st] of statuses) {
      state.statuses.set(statusKey(group.file, svc), st);
    }
  }
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
  let output = clearScreen();
  if (state.mode === MODE.LIST) {
    output += renderListView(state);
  } else if (state.mode === MODE.LOGS) {
    output += renderLogView(state);
  } else if (state.mode === MODE.EXEC) {
    output += renderExecView(state);
  }
  process.stdout.write(output);
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g, '');
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

  moduleState.logFetchTimer = setTimeout(() => {
    moduleState.logFetchTimer = null;
    startBottomLogTail(state, sk, entry.file, entry.service);
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

  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk)!.kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const child = rebuildService(entry.file, entry.service, { noCache: state.noCache });
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
    const maxLines = state.config.bottomLogCount || 10;
    if (info.lines.length > maxLines) info.lines = info.lines.slice(-maxLines);
    if (state.mode === MODE.LIST) throttledRender(state);
  };

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  render(state);

  child.on('close', () => {
    state.rebuilding.delete(sk);
    state.containerStatsHistory.delete(sk);
    state.containerStats.delete(sk);
    pollStatuses(state);

    const info = state.bottomLogLines.get(sk);
    if (info) {
      info.action = 'started';
      info.lines = [];
    }

    startBottomLogTail(state, sk, entry.file, entry.service);
    if (state.mode === MODE.LIST) render(state);
  });
}

export function doRestart(state: AppState): void {
  const entry = selectedEntry(state);
  if (!entry) return;

  const sk = statusKey(entry.file, entry.service);
  if (state.restarting.has(sk) || state.rebuilding.has(sk)) return;

  if (state.bottomLogTails.has(sk)) {
    state.bottomLogTails.get(sk)!.kill('SIGTERM');
    state.bottomLogTails.delete(sk);
  }

  const child = restartService(entry.file, entry.service);
  state.restarting.set(sk, child as Killable);

  state.bottomLogLines.set(sk, { action: 'restarting', service: entry.service, lines: [] });
  render(state);

  child.on('close', () => {
    state.restarting.delete(sk);
    state.containerStatsHistory.delete(sk);
    state.containerStats.delete(sk);
    pollStatuses(state);

    const info = state.bottomLogLines.get(sk);
    if (info) {
      info.action = 'started';
      info.lines = [];
    }

    startBottomLogTail(state, sk, entry.file, entry.service);
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

  const child = stopService(entry.file, entry.service);
  state.stopping.set(sk, child as Killable);
  state.bottomLogLines.set(sk, { action: 'stopping', service: entry.service, lines: [] });
  render(state);

  child.on('close', () => {
    state.stopping.delete(sk);
    state.bottomLogLines.delete(sk);
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

  const child = startService(entry.file, entry.service);
  state.starting.set(sk, child as Killable);
  state.bottomLogLines.set(sk, { action: 'starting', service: entry.service, lines: [] });
  render(state);

  child.on('close', () => {
    state.starting.delete(sk);
    pollStatuses(state);

    const info = state.bottomLogLines.get(sk);
    if (info) {
      info.action = 'started';
      info.lines = [];
    }

    startBottomLogTail(state, sk, entry.file, entry.service);
    if (state.mode === MODE.LIST) render(state);
  });
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

  const child = watchService(entry.file, entry.service);
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

  const graph = state.depGraphs.get(entry.file);
  if (!graph) {
    // No graph available, fall back to regular rebuild
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

  executeCascadeStep(state, entry.file, sk, cascade);
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
  const maxLines = state.config.bottomLogCount || 10;

  let child: ChildProcess | Killable;
  if (step.action === 'rebuild') {
    child = rebuildService(file, step.service, { noCache: state.noCache });
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
    if (info.lines.length > maxLines) info.lines = info.lines.slice(-maxLines);
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

export function runExecCommand(state: AppState): void {
  const cmd = state.execInput.trim();
  if (!cmd || !state.execContainerId) return;

  // Add to history
  if (state.execHistory.length === 0 || state.execHistory[state.execHistory.length - 1] !== cmd) {
    state.execHistory.push(cmd);
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
    const resolveCmd = cdTarget ? `cd ${cdTarget} && pwd` : 'cd && pwd';
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
        if (newCwd) state.execCwd = newCwd;
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

  state.mode = MODE.LOGS;
  state.logLines = [];
  state.logScrollOffset = 0;
  state.logAutoScroll = true;
  state.logSearchQuery = '';
  state.logSearchActive = false;
  state.logSearchMatches = [];
  state.logSearchMatchIdx = -1;

  const child = tailLogs(entry.file, entry.service, state.config.logTailLines);
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

  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  child.on('close', () => {
    if (state.logChild === child) {
      state.logChild = null;
    }
  });

  render(state);
}

export function exitLogs(state: AppState): void {
  if (state.logChild) {
    state.logChild.kill('SIGTERM');
    state.logChild = null;
  }
  state.logLines = [];
  state.mode = MODE.LIST;
  pollStatuses(state);
  render(state);
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

  state.logScrollOffset = Math.max(0, totalLines - lineIdx - Math.floor(availableRows / 2));
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
        executeLogSearch(state);
        render(state);
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
      case '\x15': // Ctrl+U
        state.logAutoScroll = false;
        state.logScrollOffset = Math.min(maxOffset, state.logScrollOffset + pageSize);
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
      render(state);
    } else if (key === '\r') {
      state.bottomSearchActive = false;
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
    case 'f':
    case '\r':
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

      if (state.logSearchActive || state.bottomSearchActive || state.mode === MODE.EXEC || state.execActive) {
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
            state.logScrollOffset = Math.max(0, state.logLines.length - 1);
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
  process.stdout.write('\x1b[r' + showCursor() + '\x1b[0m');
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
