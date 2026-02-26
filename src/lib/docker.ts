import { execFileSync, spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type {
  ContainerStatus,
  PortMapping,
  DockerComposePsEntry,
  DockerInspectEntry,
  DockerStatsJson,
  ParsedStatsLine,
  RebuildChild,
  RebuildEmitter,
  RebuildOptions,
  DependencyGraph,
} from './types';

export function listServices(file: string): string[] {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'config', '--services'];
  const out = execFileSync('docker', args, { cwd, encoding: 'utf8', timeout: 10000 });
  return out.trim().split('\n').filter(Boolean);
}

export function getStatuses(file: string): Map<string, ContainerStatus> {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'ps', '--format', 'json'];
  let out: string;
  try {
    out = execFileSync('docker', args, { cwd, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return new Map();
  }

  const trimmed = out.trim();
  if (!trimmed) return new Map();

  const statuses = new Map<string, ContainerStatus>();
  let containers: DockerComposePsEntry[];

  try {
    if (trimmed.startsWith('[')) {
      containers = JSON.parse(trimmed) as DockerComposePsEntry[];
    } else {
      containers = trimmed.split('\n').filter(Boolean).map(line => JSON.parse(line) as DockerComposePsEntry);
    }
  } catch {
    return new Map();
  }

  const idToService = new Map<string, string>();

  for (const c of containers) {
    const name = c.Service || c.Name || '';
    const state = (c.State || '').toLowerCase();
    const health = (c.Health || '').toLowerCase();
    const createdAt = c.CreatedAt || null;
    const id = c.ID || null;

    let ports: PortMapping[] = [];
    if (Array.isArray(c.Publishers)) {
      for (const p of c.Publishers) {
        if (p.PublishedPort && p.PublishedPort > 0) {
          ports.push({ published: p.PublishedPort, target: p.TargetPort });
        }
      }
    } else if (c.Ports) {
      const portMatches = c.Ports.matchAll(/(\d+)->(\d+)/g);
      for (const m of portMatches) {
        ports.push({ published: parseInt(m[1], 10), target: parseInt(m[2], 10) });
      }
    }
    const seen = new Set<number>();
    ports = ports.filter(p => {
      if (seen.has(p.published)) return false;
      seen.add(p.published);
      return true;
    });

    statuses.set(name, { state, health, createdAt, startedAt: null, id: id || null, ports });
    if (id) idToService.set(id, name);
  }

  const ids = [...idToService.keys()];
  if (ids.length > 0) {
    try {
      const inspectOut = execFileSync('docker', ['inspect', ...ids], {
        encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe']
      });
      const inspected = JSON.parse(inspectOut) as DockerInspectEntry[];
      for (const info of inspected) {
        for (const [id, svc] of idToService) {
          if (info.Id && info.Id.startsWith(id)) {
            const status = statuses.get(svc);
            if (status && info.State) {
              status.startedAt = info.State.StartedAt || null;
            }
            break;
          }
        }
      }
    } catch {
      // Ignore inspect errors
    }
  }

  return statuses;
}

export function rebuildService(file: string, service: string, opts: RebuildOptions = {}): RebuildChild {
  const cwd = path.dirname(path.resolve(file));
  const resolvedFile = path.resolve(file);
  const spawnOpts = {
    cwd, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], detached: false,
    env: { ...process.env, BUILDKIT_PROGRESS: 'plain' },
  };

  if (opts.noCache) {
    const emitter = new EventEmitter() as RebuildEmitter;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    emitter.stdout = stdout;
    emitter.stderr = stderr;

    const buildChild = spawn('docker', ['compose', '-f', resolvedFile, 'build', '--no-cache', service], spawnOpts);
    buildChild.stdout.pipe(stdout, { end: false });
    buildChild.stderr.pipe(stderr, { end: false });

    buildChild.on('close', (code: number | null) => {
      if (code !== 0) {
        stdout.end();
        stderr.end();
        emitter.emit('close', code);
        return;
      }
      const upChild = spawn('docker', ['compose', '-f', resolvedFile, 'up', '-d', '--force-recreate', service], spawnOpts);
      upChild.stdout.pipe(stdout);
      upChild.stderr.pipe(stderr);
      upChild.on('close', (upCode: number | null) => emitter.emit('close', upCode));
      emitter.kill = (sig?: string) => upChild.kill(sig as NodeJS.Signals | undefined);
    });

    emitter.kill = (sig?: string) => buildChild.kill(sig as NodeJS.Signals | undefined);
    return emitter;
  }

  const args = ['compose', '-f', resolvedFile, 'up', '-d', '--build', service];
  const child = spawn('docker', args, spawnOpts);
  return child;
}

export function tailLogs(file: string, service: string, tailLines: number): ChildProcess {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'logs', '-f', '--tail', String(tailLines), service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

export function getContainerId(file: string, service: string): string | null {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'ps', '-q', service];
  try {
    const out = execFileSync('docker', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function tailContainerLogs(containerId: string, tailLines: number): ChildProcess {
  const args = ['logs', '-f', '--tail', String(tailLines), containerId];
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

export function fetchContainerLogs(containerId: string, tailLines: number): ChildProcess {
  const child = spawn('docker', ['logs', '--tail', String(tailLines), containerId], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

export function restartService(file: string, service: string): ChildProcess {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'restart', service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  return child;
}

export function stopService(file: string, service: string): ChildProcess {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'stop', service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  return child;
}

export function startService(file: string, service: string): ChildProcess {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'start', service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  return child;
}

export function fetchContainerStats(containerIds: string[]): ChildProcess {
  const args = ['stats', '--no-stream', '--format', '{{json .}}', ...containerIds];
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

export function parseMemString(str: string | null | undefined): number {
  if (!str) return 0;
  const match = str.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { b: 1, kib: 1024, mib: 1024 * 1024, gib: 1024 * 1024 * 1024, tib: 1024 * 1024 * 1024 * 1024, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12 };
  return val * (multipliers[unit] || 1);
}

export function parseStatsLine(jsonStr: string): ParsedStatsLine | null {
  try {
    const obj = JSON.parse(jsonStr) as DockerStatsJson;
    const cpuPercent = parseFloat((obj.CPUPerc || '').replace('%', '')) || 0;
    const memUsageStr = (obj.MemUsage || '').split('/')[0].trim();
    const memUsageBytes = parseMemString(memUsageStr);
    const id = obj.ID || '';
    const name = obj.Name || '';
    return { id, name, cpuPercent, memUsageBytes };
  } catch {
    return null;
  }
}

// --- Watch ---

let watchAvailableCache: boolean | null = null;

export function isWatchAvailable(): boolean {
  if (watchAvailableCache !== null) return watchAvailableCache;
  try {
    execFileSync('docker', ['compose', 'watch', '--help'], {
      encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    watchAvailableCache = true;
  } catch {
    watchAvailableCache = false;
  }
  return watchAvailableCache;
}

export function watchService(file: string, service: string): ChildProcess {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'watch', service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  return child;
}

// --- Dependency Graph ---

export function parseDependencyGraph(file: string): DependencyGraph {
  const cwd = path.dirname(path.resolve(file));
  const resolvedFile = path.resolve(file);
  const dependsOn = new Map<string, string[]>();
  const dependedBy = new Map<string, string[]>();

  try {
    const out = execFileSync('docker', ['compose', '-f', resolvedFile, 'config', '--format', 'json'], {
      cwd, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const config = JSON.parse(out);
    const services = config.services || {};
    for (const [name, def] of Object.entries(services)) {
      const deps: string[] = [];
      const svcDef = def as Record<string, unknown>;
      if (svcDef.depends_on) {
        if (Array.isArray(svcDef.depends_on)) {
          deps.push(...(svcDef.depends_on as string[]));
        } else if (typeof svcDef.depends_on === 'object') {
          deps.push(...Object.keys(svcDef.depends_on as Record<string, unknown>));
        }
      }
      dependsOn.set(name, deps);
      for (const dep of deps) {
        if (!dependedBy.has(dep)) dependedBy.set(dep, []);
        dependedBy.get(dep)!.push(name);
      }
    }
  } catch {
    // Fallback: try plain docker compose config and regex-parse YAML
    try {
      const out = execFileSync('docker', ['compose', '-f', resolvedFile, 'config'], {
        cwd, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let currentService: string | null = null;
      let inDependsOn = false;
      for (const line of out.split('\n')) {
        // Top-level service name (2-space indent under services:)
        const svcMatch = line.match(/^  (\S+):$/);
        if (svcMatch) {
          currentService = svcMatch[1];
          inDependsOn = false;
          if (!dependsOn.has(currentService)) dependsOn.set(currentService, []);
          continue;
        }
        if (currentService && line.match(/^\s{4}depends_on:/)) {
          inDependsOn = true;
          continue;
        }
        if (inDependsOn && currentService) {
          const depMatch = line.match(/^\s{6}(\S+):/);
          if (depMatch) {
            dependsOn.get(currentService)!.push(depMatch[1]);
            if (!dependedBy.has(depMatch[1])) dependedBy.set(depMatch[1], []);
            dependedBy.get(depMatch[1])!.push(currentService);
            continue;
          }
          if (!line.match(/^\s{6,}/)) inDependsOn = false;
        }
      }
    } catch {
      // No dependency info available
    }
  }

  return { dependsOn, dependedBy };
}

// --- Exec ---

export function execInContainer(containerId: string, command: string, cwd?: string): ChildProcess {
  const args = ['exec'];
  if (cwd) args.push('-w', cwd);
  args.push(containerId, 'sh', '-c', command);
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

