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

  for (const c of containers) {
    const name = c.Service || c.Name;
    const state = (c.State || '').toLowerCase();
    const health = (c.Health || '').toLowerCase();
    statuses.set(name, { state, health });
  }

  return statuses;
}

function rebuildService(file, service) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'up', '-d', '--build', service];
  const child = spawn('docker', args, { cwd, stdio: 'ignore', detached: false });
  return child;
}

function tailLogs(file, service, tailLines) {
  const cwd = path.dirname(path.resolve(file));
  const args = ['compose', '-f', path.resolve(file), 'logs', '-f', '--tail', String(tailLines), service];
  const child = spawn('docker', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

module.exports = { listServices, getStatuses, rebuildService, tailLogs };
