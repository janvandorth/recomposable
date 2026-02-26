#!/usr/bin/env node
'use strict';

import { createState, statusKey, buildFlatList, MODE } from '../src/lib/state';
import { clearScreen, renderListView, renderLogView, renderExecView } from '../src/lib/renderer';
import type { Killable } from '../src/lib/types';

// --- Mock terminal dimensions ---
const COLS = 128;
const ROWS = 48;
process.stdout.columns = COLS;
process.stdout.rows = ROWS;

// --- Time helpers ---
const NOW = Date.now();
const minutes = (n: number): string => new Date(NOW - n * 60 * 1000).toISOString();
const hours = (n: number): string => new Date(NOW - n * 60 * 60 * 1000).toISOString();
const days = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

// --- Mock config ---
const config = {
  composeFiles: [
    'infra/docker-compose.yml',
    'services/docker-compose.yml',
    'apps/docker-compose.yml',
  ],
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

// --- Build mock state ---
const state = createState(config);

state.groups = [
  {
    file: 'infra/docker-compose.yml',
    label: 'infra',
    services: ['postgres', 'redis', 'rabbitmq', 'minio', 'qdrant'],
    error: null,
  },
  {
    file: 'services/docker-compose.yml',
    label: 'services',
    services: [
      'api-gateway',
      'auth-service',
      'user-service',
      'billing-service',
      'notification-service',
      'search-service',
      'analytics-service',
    ],
    error: null,
  },
  {
    file: 'apps/docker-compose.yml',
    label: 'apps',
    services: ['web-app', 'admin-dashboard', 'worker'],
    error: null,
  },
];

state.flatList = buildFlatList(state.groups);

// --- Mock statuses ---
const mockStatuses: Record<string, { state: string; health: string; createdAt: string; startedAt: string; id: string; ports: Array<{ published: number; target: number }> } | null> = {
  'infra/docker-compose.yml::postgres':  { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc1', ports: [{ published: 5432, target: 5432 }] },
  'infra/docker-compose.yml::redis':     { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc2', ports: [{ published: 6379, target: 6379 }] },
  'infra/docker-compose.yml::rabbitmq':  { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc3', ports: [{ published: 5672, target: 5672 }, { published: 15672, target: 15672 }] },
  'infra/docker-compose.yml::minio':     { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc4', ports: [{ published: 9000, target: 9000 }] },
  'infra/docker-compose.yml::qdrant':    { state: 'running', health: 'unhealthy', createdAt: days(14), startedAt: days(3), id: 'abc5', ports: [{ published: 6333, target: 6333 }] },

  'services/docker-compose.yml::api-gateway':          { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc1', ports: [{ published: 8080, target: 8080 }] },
  'services/docker-compose.yml::auth-service':         { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc2', ports: [{ published: 5001, target: 5001 }] },
  'services/docker-compose.yml::user-service':         { state: 'running', health: 'healthy', createdAt: hours(2), startedAt: hours(2), id: 'svc3', ports: [{ published: 5002, target: 5002 }] },
  'services/docker-compose.yml::billing-service':      { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc4', ports: [{ published: 5003, target: 5003 }] },
  'services/docker-compose.yml::notification-service': null,
  'services/docker-compose.yml::search-service':       { state: 'running', health: 'healthy', createdAt: days(2), startedAt: days(1), id: 'svc6', ports: [{ published: 5005, target: 5005 }] },
  'services/docker-compose.yml::analytics-service':    { state: 'running', health: 'healthy', createdAt: days(1), startedAt: minutes(45), id: 'svc7', ports: [{ published: 5006, target: 5006 }] },

  'apps/docker-compose.yml::web-app':          { state: 'running', health: 'healthy', createdAt: hours(2), startedAt: hours(2), id: 'app1', ports: [{ published: 3000, target: 3000 }] },
  'apps/docker-compose.yml::admin-dashboard':  { state: 'running', health: 'healthy', createdAt: days(3), startedAt: days(1), id: 'app2', ports: [{ published: 3001, target: 3001 }] },
  'apps/docker-compose.yml::worker':           { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'app3', ports: [] },
};

for (const [key, val] of Object.entries(mockStatuses)) {
  if (val) state.statuses.set(key, val);
}

// --- Mock log pattern counts ---
const mockLogCounts: Record<string, Record<string, number>> = {
  'infra/docker-compose.yml::postgres':  { 'WRN]': 0, 'ERR]': 0 },
  'infra/docker-compose.yml::redis':     { 'WRN]': 0, 'ERR]': 0 },
  'infra/docker-compose.yml::rabbitmq':  { 'WRN]': 0, 'ERR]': 0 },
  'infra/docker-compose.yml::minio':     { 'WRN]': 12, 'ERR]': 0 },
  'infra/docker-compose.yml::qdrant':    { 'WRN]': 3, 'ERR]': 47 },

  'services/docker-compose.yml::api-gateway':          { 'WRN]': 156, 'ERR]': 0 },
  'services/docker-compose.yml::auth-service':         { 'WRN]': 21, 'ERR]': 0 },
  'services/docker-compose.yml::user-service':         { 'WRN]': 8, 'ERR]': 2 },
  'services/docker-compose.yml::billing-service':      { 'WRN]': 0, 'ERR]': 0 },
  'services/docker-compose.yml::notification-service': { 'WRN]': 0, 'ERR]': 0 },
  'services/docker-compose.yml::search-service':       { 'WRN]': 34, 'ERR]': 0 },
  'services/docker-compose.yml::analytics-service':    { 'WRN]': 512, 'ERR]': 3 },

  'apps/docker-compose.yml::web-app':          { 'WRN]': 29, 'ERR]': 0 },
  'apps/docker-compose.yml::admin-dashboard':  { 'WRN]': 0, 'ERR]': 0 },
  'apps/docker-compose.yml::worker':           { 'WRN]': 7, 'ERR]': 0 },
};

for (const [key, counts] of Object.entries(mockLogCounts)) {
  const m = new Map<string, number>();
  for (const [p, c] of Object.entries(counts)) m.set(p, c);
  state.logCounts.set(key, m);
}

// --- Mock container stats ---
const mockStats: Record<string, { cpuPercent: number; memUsageBytes: number }> = {
  'infra/docker-compose.yml::postgres':  { cpuPercent: 3.2, memUsageBytes: 256 * 1024 * 1024 },
  'infra/docker-compose.yml::redis':     { cpuPercent: 0.8, memUsageBytes: 42 * 1024 * 1024 },
  'infra/docker-compose.yml::rabbitmq':  { cpuPercent: 1.5, memUsageBytes: 178 * 1024 * 1024 },
  'infra/docker-compose.yml::minio':     { cpuPercent: 0.3, memUsageBytes: 95 * 1024 * 1024 },
  'infra/docker-compose.yml::qdrant':    { cpuPercent: 12.4, memUsageBytes: 890 * 1024 * 1024 },

  'services/docker-compose.yml::api-gateway':          { cpuPercent: 8.7, memUsageBytes: 312 * 1024 * 1024 },
  'services/docker-compose.yml::auth-service':         { cpuPercent: 2.1, memUsageBytes: 128 * 1024 * 1024 },
  'services/docker-compose.yml::user-service':         { cpuPercent: 4.3, memUsageBytes: 195 * 1024 * 1024 },
  'services/docker-compose.yml::billing-service':      { cpuPercent: 1.0, memUsageBytes: 87 * 1024 * 1024 },
  'services/docker-compose.yml::search-service':       { cpuPercent: 55.2, memUsageBytes: 620 * 1024 * 1024 },
  'services/docker-compose.yml::analytics-service':    { cpuPercent: 15.8, memUsageBytes: 445 * 1024 * 1024 },

  'apps/docker-compose.yml::web-app':          { cpuPercent: 6.1, memUsageBytes: 234 * 1024 * 1024 },
  'apps/docker-compose.yml::admin-dashboard':  { cpuPercent: 0.5, memUsageBytes: 67 * 1024 * 1024 },
  'apps/docker-compose.yml::worker':           { cpuPercent: 22.3, memUsageBytes: 1.2 * 1024 * 1024 * 1024 },
};

for (const [key, val] of Object.entries(mockStats)) {
  state.containerStats.set(key, val);
}

// --- Mock: one service is rebuilding ---
const mockKillable: Killable = { kill: () => {} };
state.rebuilding.set('services/docker-compose.yml::analytics-service', mockKillable);

// --- Mock: two services being watched ---
state.watching.set('apps/docker-compose.yml::web-app', mockKillable);
state.watching.set('services/docker-compose.yml::api-gateway', mockKillable);

// --- Position cursor on user-service (index 7) ---
state.cursor = 7;
state.scrollOffset = 0;
state.showBottomLogs = true;

// --- Mock bottom log panel showing logs for the selected service ---
const selectedKey = statusKey('services/docker-compose.yml', 'user-service');
state.selectedLogKey = selectedKey;
state.bottomLogLines.set(selectedKey, {
  action: 'logs',
  service: 'user-service',
  lines: [
    '[14:10:52 INF] Request finished HTTP/1.1 POST /api/v1/users/batch - 200 5.347ms',
    '[14:11:19 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:11:19 INF] Executing endpoint \'Health checks\'',
    '[14:11:19 INF] Request finished HTTP/1.1 GET /health - 200 1.294ms',
    '[14:11:32 WRN] Slow query detected: SELECT * FROM users WHERE email LIKE \'%@example%\' (1823ms)',
    '[14:11:49 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:11:49 INF] Executing endpoint \'Health checks\'',
    '[14:11:49 INF] Request finished HTTP/1.1 GET /health - 200 1.661ms',
    '[14:12:01 INF] Request finished HTTP/1.1 GET /api/v1/users/me - 200 12.44ms',
    '[14:12:15 ERR] Connection pool exhausted, retrying in 500ms...',
  ],
});

// --- Determine mode ---
const mode = process.argv[2] || 'list';

if (mode === 'exec') {
  state.mode = MODE.EXEC;
  state.execService = 'user-service';
  state.execContainerId = 'svc3';
  state.execInput = 'cat /app/config/';
  state.execHistory = ['ls -la', 'env', 'cat /proc/1/status', 'ps aux'];
  state.execOutputLines = [
    '$ ls -la',
    'total 84',
    'drwxr-xr-x 1 node node  4096 Feb 24 09:12 .',
    'drwxr-xr-x 1 root root  4096 Feb 24 09:12 ..',
    '-rw-r--r-- 1 node node   523 Feb 24 09:10 package.json',
    '-rw-r--r-- 1 node node 41672 Feb 24 09:10 package-lock.json',
    'drwxr-xr-x 2 node node  4096 Feb 24 09:12 node_modules',
    'drwxr-xr-x 3 node node  4096 Feb 24 09:12 src',
    'drwxr-xr-x 2 node node  4096 Feb 24 09:12 config',
    '-rw-r--r-- 1 node node   247 Feb 24 09:10 Dockerfile',
    '',
    '$ env',
    'NODE_ENV=production',
    'DATABASE_URL=postgres://db:5432/users',
    'REDIS_URL=redis://redis:6379',
    'PORT=5002',
    'LOG_LEVEL=info',
    '',
    '$ ps aux',
    'PID   USER     TIME  COMMAND',
    '    1 node      0:12 node src/index.js',
    '   42 node      0:00 ps aux',
  ];
} else if (mode === 'exec-inline') {
  state.mode = MODE.LIST;
  state.execActive = true;
  state.execService = 'user-service';
  state.execContainerId = 'svc3';
  state.execInput = 'cat /app/config/';
  state.execHistory = ['ls -la', 'env', 'ps aux'];
  state.execOutputLines = [
    '$ ls -la',
    'total 84',
    'drwxr-xr-x 1 node node  4096 Feb 24 09:12 .',
    'drwxr-xr-x 1 root root  4096 Feb 24 09:12 ..',
    '-rw-r--r-- 1 node node   523 Feb 24 09:10 package.json',
    '-rw-r--r-- 1 node node 41672 Feb 24 09:10 package-lock.json',
    'drwxr-xr-x 2 node node  4096 Feb 24 09:12 node_modules',
    'drwxr-xr-x 3 node node  4096 Feb 24 09:12 src',
    'drwxr-xr-x 2 node node  4096 Feb 24 09:12 config',
    '-rw-r--r-- 1 node node   247 Feb 24 09:10 Dockerfile',
    '',
    '$ env',
    'NODE_ENV=production',
    'DATABASE_URL=postgres://db:5432/users',
    'REDIS_URL=redis://redis:6379',
    'PORT=5002',
    'LOG_LEVEL=info',
    '',
    '$ ps aux',
    'PID   USER     TIME  COMMAND',
    '    1 node      0:12 node src/index.js',
    '   42 node      0:00 ps aux',
  ];
} else if (mode === 'logs') {
  state.mode = MODE.LOGS;
  state.logAutoScroll = true;
  state.logScrollOffset = 0;
  state.logLines = [
    '[14:08:01 INF] Application starting...',
    '[14:08:01 INF] Loaded configuration from /app/config/production.json',
    '[14:08:02 INF] Connecting to database: postgres://db:5432/users',
    '[14:08:02 INF] Database connection established',
    '[14:08:02 INF] Running pending migrations...',
    '[14:08:03 INF] Applied migration: 20250201_add_user_preferences',
    '[14:08:03 INF] Starting HTTP server on port 5002',
    '[14:08:03 INF] Registered 24 API endpoints',
    '[14:08:03 INF] Health check endpoint: /health',
    '[14:08:04 INF] Connected to Redis cache at redis:6379',
    '[14:08:04 INF] Connected to RabbitMQ at amqp://rabbitmq:5672',
    '[14:08:04 INF] Application started successfully',
    '',
    '[14:08:15 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:08:15 INF] Executing endpoint \'Health checks\'',
    '[14:08:15 INF] Request finished HTTP/1.1 GET /health - 200 0.892ms',
    '[14:08:30 INF] Request starting HTTP/1.1 POST /api/v1/users - null application/json',
    '[14:08:30 INF] Creating new user: john.doe@example.com',
    '[14:08:30 INF] User created successfully: id=usr_8f2k3j',
    '[14:08:30 INF] Publishing event: user.created',
    '[14:08:30 INF] Request finished HTTP/1.1 POST /api/v1/users - 201 23.441ms',
    '[14:08:45 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:08:45 INF] Request finished HTTP/1.1 GET /health - 200 0.712ms',
    '[14:09:01 INF] Request starting HTTP/1.1 GET /api/v1/users?page=1&limit=50 - null',
    '[14:09:01 INF] Fetching users: page=1 limit=50 total=1247',
    '[14:09:01 INF] Request finished HTTP/1.1 GET /api/v1/users - 200 45.23ms',
    '[14:09:15 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:09:15 INF] Request finished HTTP/1.1 GET /health - 200 0.681ms',
    '[14:09:22 WRN] Rate limit approaching for IP 10.0.3.42: 89/100 requests in window',
    '[14:09:30 INF] Request starting HTTP/1.1 PATCH /api/v1/users/usr_8f2k3j - null application/json',
    '[14:09:30 INF] Updating user profile: usr_8f2k3j',
    '[14:09:30 INF] Publishing event: user.updated',
    '[14:09:30 INF] Request finished HTTP/1.1 PATCH /api/v1/users/usr_8f2k3j - 200 18.92ms',
    '[14:09:45 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:09:45 INF] Request finished HTTP/1.1 GET /health - 200 0.543ms',
    '[14:10:02 INF] Request starting HTTP/1.1 DELETE /api/v1/users/usr_old123 - null',
    '[14:10:02 WRN] Soft-deleting user with active sessions: usr_old123 (3 sessions)',
    '[14:10:02 INF] Publishing event: user.deleted',
    '[14:10:02 INF] Request finished HTTP/1.1 DELETE /api/v1/users/usr_old123 - 200 31.02ms',
    '[14:10:15 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:10:15 INF] Request finished HTTP/1.1 GET /health - 200 0.891ms',
    '[14:10:30 INF] Request starting HTTP/1.1 POST /api/v1/users/batch - null application/json',
    '[14:10:30 INF] Batch import: processing 150 users',
    '[14:10:45 INF] Batch import: validated 148/150 (2 duplicates skipped)',
    '[14:10:52 INF] Request finished HTTP/1.1 POST /api/v1/users/batch - 200 5.347ms',
    '[14:11:19 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:11:19 INF] Executing endpoint \'Health checks\'',
    '[14:11:19 INF] Request finished HTTP/1.1 GET /health - 200 1.294ms',
    '[14:11:32 WRN] Slow query detected: SELECT * FROM users WHERE email LIKE \'%@example%\' (1823ms)',
    '[14:11:49 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:11:49 INF] Executing endpoint \'Health checks\'',
    '[14:11:49 INF] Request finished HTTP/1.1 GET /health - 200 1.661ms',
    '[14:12:01 INF] Request finished HTTP/1.1 GET /api/v1/users/me - 200 12.44ms',
    '[14:12:15 ERR] Connection pool exhausted, retrying in 500ms...',
    '[14:12:15 ERR] Npgsql.NpgsqlException: The connection pool has been exhausted',
    '[14:12:16 INF] Connection pool recovered after retry',
    '[14:12:30 INF] Request starting HTTP/1.1 GET /health - null',
    '[14:12:30 INF] Request finished HTTP/1.1 GET /health - 200 0.921ms',
    '[14:12:45 INF] Request starting HTTP/1.1 GET /api/v1/users/search?q=john - null',
    '[14:12:45 INF] Search query: "john" - 23 results',
    '[14:12:45 INF] Request finished HTTP/1.1 GET /api/v1/users/search - 200 67.12ms',
  ];
} else {
  state.mode = MODE.LIST;
}

// --- Render ---
let output = clearScreen();
if (state.mode === MODE.LIST) {
  output += renderListView(state);
} else if (state.mode === MODE.EXEC) {
  output += renderExecView(state);
} else {
  output += renderLogView(state);
}
process.stdout.write(output);

// Show cursor and reset
process.stdout.write('\x1b[?25h');
