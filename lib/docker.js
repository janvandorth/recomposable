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
  if (trimmed.startsWith('[')) {
    containers = JSON.parse(trimmed);
  } else {
    containers = trimmed.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  const idToService = new Map();

  for (const c of containers) {
    const name = c.Service || c.Name;
    const state = (c.State || '').toLowerCase();
    const health = (c.Health || '').toLowerCase();
    const createdAt = c.CreatedAt || null;
    const id = c.ID || null;
    statuses.set(name, { state, health, createdAt, startedAt: null, id: id || null });
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

function rebuildService(file, service) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'up', '-d', '--build', service];
  const child = spawn('docker', args, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
    env: { ...process.env, BUILDKIT_PROGRESS: 'plain' },
  });
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

module.exports = { listServices, getStatuses, rebuildService, restartService, tailLogs, getContainerId, tailContainerLogs, fetchContainerLogs };
