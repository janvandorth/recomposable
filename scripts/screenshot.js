#!/usr/bin/env node
'use strict';

/**
 * Generates terminal screenshots of recomposable with mock data.
 * Usage:
 *   node scripts/screenshot.js            # list view (default)
 *   node scripts/screenshot.js logs       # full logs view
 */

const { createState, statusKey, buildFlatList, MODE } = require('../lib/state');
const { clearScreen, renderListView, renderLogView } = require('../lib/renderer');

// --- Mock terminal dimensions ---
const COLS = 120;
const ROWS = 48;
process.stdout.columns = COLS;
process.stdout.rows = ROWS;

// --- Time helpers ---
const NOW = Date.now();
const minutes = (n) => new Date(NOW - n * 60 * 1000).toISOString();
const hours = (n) => new Date(NOW - n * 60 * 60 * 1000).toISOString();
const days = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

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
const mockStatuses = {
  // infra - mostly long-running
  'infra/docker-compose.yml::postgres':  { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc1' },
  'infra/docker-compose.yml::redis':     { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc2' },
  'infra/docker-compose.yml::rabbitmq':  { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc3' },
  'infra/docker-compose.yml::minio':     { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc4' },
  'infra/docker-compose.yml::qdrant':    { state: 'running', health: 'unhealthy', createdAt: days(14), startedAt: days(3), id: 'abc5' },

  // services - mix of states
  'services/docker-compose.yml::api-gateway':          { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc1' },
  'services/docker-compose.yml::auth-service':         { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc2' },
  'services/docker-compose.yml::user-service':         { state: 'running', health: 'healthy', createdAt: hours(2), startedAt: hours(2), id: 'svc3' },
  'services/docker-compose.yml::billing-service':      { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc4' },
  'services/docker-compose.yml::notification-service': null,  // stopped
  'services/docker-compose.yml::search-service':       { state: 'running', health: 'healthy', createdAt: days(2), startedAt: days(1), id: 'svc6' },
  'services/docker-compose.yml::analytics-service':    { state: 'running', health: 'healthy', createdAt: days(1), startedAt: minutes(45), id: 'svc7' },

  // apps
  'apps/docker-compose.yml::web-app':          { state: 'running', health: 'healthy', createdAt: hours(2), startedAt: hours(2), id: 'app1' },
  'apps/docker-compose.yml::admin-dashboard':  { state: 'running', health: 'healthy', createdAt: days(3), startedAt: days(1), id: 'app2' },
  'apps/docker-compose.yml::worker':           { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'app3' },
};

for (const [key, val] of Object.entries(mockStatuses)) {
  if (val) state.statuses.set(key, val);
}

// --- Mock log pattern counts ---
const mockLogCounts = {
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
  const m = new Map();
  for (const [p, c] of Object.entries(counts)) m.set(p, c);
  state.logCounts.set(key, m);
}

// --- Mock: one service is rebuilding ---
// analytics-service is being rebuilt — show yellow indicator
state.rebuilding.set('services/docker-compose.yml::analytics-service', { kill: () => {} });

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

if (mode === 'logs') {
  // Full logs view for user-service
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
} else {
  output += renderLogView(state);
}
process.stdout.write(output);

// Show cursor and reset
process.stdout.write('\x1b[?25h');
