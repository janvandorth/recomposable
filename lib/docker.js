'use strict';

const { execFileSync, spawn } = require('child_process');
const path = require('path');

function listServices(file) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'config', '--services'];
  const out = execFileSync('docker', args, { cwd, encoding: 'utf8', timeout: 10000 });
  return out.trim().split('\n').filter(Boolean);
}

function getStatuses(file) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'ps', '--format', 'json'];
  let out;
  try {
    out = execFileSync('docker', args, { cwd, encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return new Map();
  }

  const trimmed = out.trim();
  if (!trimmed) return new Map();

  const statuses = new Map();
  let containers;

  // docker compose ps outputs NDJSON (one object per line) or a JSON array
  try {
    if (trimmed.startsWith('[')) {
      containers = JSON.parse(trimmed);
    } else {
      containers = trimmed.split('\n').filter(Boolean).map(line => JSON.parse(line));
    }
  } catch {
    return new Map();
  }

  const idToService = new Map();

  for (const c of containers) {
    const name = c.Service || c.Name;
    const state = (c.State || '').toLowerCase();
    const health = (c.Health || '').toLowerCase();
    const createdAt = c.CreatedAt || null;
    const id = c.ID || null;

    // Extract published ports
    let ports = [];
    if (Array.isArray(c.Publishers)) {
      for (const p of c.Publishers) {
        if (p.PublishedPort && p.PublishedPort > 0) {
          ports.push({ published: p.PublishedPort, target: p.TargetPort });
        }
      }
    } else if (c.Ports) {
      // Fallback: parse from Ports string like "0.0.0.0:3000->3000/tcp"
      const portMatches = c.Ports.matchAll(/(\d+)->(\d+)/g);
      for (const m of portMatches) {
        ports.push({ published: parseInt(m[1], 10), target: parseInt(m[2], 10) });
      }
    }
    // Deduplicate by published port
    const seen = new Set();
    ports = ports.filter(p => {
      if (seen.has(p.published)) return false;
      seen.add(p.published);
      return true;
    });

    statuses.set(name, { state, health, createdAt, startedAt: null, id: id || null, ports });
    if (id) idToService.set(id, name);
  }

  // Batch docker inspect to get startedAt timestamps
  const ids = [...idToService.keys()];
  if (ids.length > 0) {
    try {
      const inspectOut = execFileSync('docker', ['inspect', ...ids], {
        encoding: 'utf8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe']
      });
      const inspected = JSON.parse(inspectOut);
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

function rebuildService(file, service, opts = {}) {
  const cwd = path.dirname(path.resolve(file));
  const resolvedFile = path.resolve(file);
  const spawnOpts = {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
    env: { ...process.env, BUILDKIT_PROGRESS: 'plain' },
  };

  if (opts.noCache) {
    // Chain: build --no-cache then up --force-recreate (skip all caches)
    // Use safe spawn (no shell) to avoid command injection
    const { EventEmitter } = require('events');
    const { PassThrough } = require('stream');
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    emitter.stdout = stdout;
    emitter.stderr = stderr;

    const buildChild = spawn('docker', ['compose', '-f', resolvedFile, 'build', '--no-cache', service], spawnOpts);
    buildChild.stdout.pipe(stdout, { end: false });
    buildChild.stderr.pipe(stderr, { end: false });

    buildChild.on('close', (code) => {
      if (code !== 0) {
        stdout.end();
        stderr.end();
        emitter.emit('close', code);
        return;
      }
      const upChild = spawn('docker', ['compose', '-f', resolvedFile, 'up', '-d', '--force-recreate', service], spawnOpts);
      upChild.stdout.pipe(stdout);
      upChild.stderr.pipe(stderr);
      upChild.on('close', (upCode) => emitter.emit('close', upCode));
      emitter.kill = (sig) => upChild.kill(sig);
    });

    emitter.kill = (sig) => buildChild.kill(sig);
    return emitter;
  }

  const args = ['compose', '-f', resolvedFile, 'up', '-d', '--build', service];
  const child = spawn('docker', args, spawnOpts);
  return child;
}

function tailLogs(file, service, tailLines) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'logs', '-f', '--tail', String(tailLines), service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

function getContainerId(file, service) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'ps', '-q', service];
  try {
    const out = execFileSync('docker', args, { cwd, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function tailContainerLogs(containerId, tailLines) {
  const args = ['logs', '-f', '--tail', String(tailLines), containerId];
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

function fetchContainerLogs(containerId, tailLines) {
  const child = spawn('docker', ['logs', '--tail', String(tailLines), containerId], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

function restartService(file, service) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'restart', service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  return child;
}

function stopService(file, service) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'stop', service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  return child;
}

function startService(file, service) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'start', service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  return child;
}

function fetchContainerStats(containerIds) {
  const args = ['stats', '--no-stream', '--format', '{{json .}}', ...containerIds];
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

function parseMemString(str) {
  if (!str) return 0;
  const match = str.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = { b: 1, kib: 1024, mib: 1024 * 1024, gib: 1024 * 1024 * 1024, tib: 1024 * 1024 * 1024 * 1024, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12 };
  return val * (multipliers[unit] || 1);
}

function parseStatsLine(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
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

module.exports = { listServices, getStatuses, rebuildService, restartService, stopService, startService, tailLogs, getContainerId, tailContainerLogs, fetchContainerLogs, fetchContainerStats, parseStatsLine, parseMemString };
