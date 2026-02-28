#!/usr/bin/env node
'use strict';

import { createState, statusKey, buildFlatList, MODE } from '../src/lib/state';
import { clearScreen, renderListView, renderLogView } from '../src/lib/renderer';
import type { Killable } from '../src/lib/types';

// --- Mock terminal dimensions ---
const COLS = 145;
const ROWS = 40;
process.stdout.columns = COLS;
process.stdout.rows = ROWS;

// --- Time helpers ---
const NOW = Date.now();
const minutes = (n: number): string => new Date(NOW - n * 60 * 1000).toISOString();
const hours = (n: number): string => new Date(NOW - n * 60 * 60 * 1000).toISOString();
const days = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

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

const mockKillable: Killable = { kill: () => {} };

// ── Reusable build log lines (auth-service, first rebuild) ──
const authBuildEarly = [
  '#1 [internal] load build definition from Dockerfile',
  '#1 transferring dockerfile: 847B done',
  '#2 [internal] load metadata for docker.io/library/node:20-alpine',
  '#2 DONE 1.2s',
  '#3 [build 1/6] FROM docker.io/library/node:20-alpine@sha256:a1b2c3',
  '#3 CACHED',
];
const authBuildFull = [
  ...authBuildEarly,
  '#4 [build 2/6] WORKDIR /app',
  '#4 CACHED',
  '#5 [build 3/6] COPY package*.json ./',
  '#5 DONE 0.1s',
  '#6 [build 4/6] RUN npm ci --production',
  '#6 npm warn deprecated inflight@1.0.6',
  '#6 added 247 packages in 8.4s',
  '#6 DONE 9.1s',
  '#7 [build 5/6] COPY . .',
  '#7 DONE 0.3s',
  '#8 [build 6/6] RUN npm run build',
  '#8 > auth-service@2.1.0 build',
  '#8 > tsc && tsc-alias',
  '#8 DONE 4.7s',
];

// ── Build log lines (api-gateway, second rebuild in new worktree) ──
const gwBuildEarly = [
  '#1 [internal] load build definition from Dockerfile',
  '#1 transferring dockerfile: 612B done',
  '#2 [internal] load metadata for docker.io/library/node:20-alpine',
  '#2 DONE 0.8s',
  '#3 [build 1/5] FROM docker.io/library/node:20-alpine@sha256:d4e5f6',
  '#3 CACHED',
  '#4 [build 2/5] WORKDIR /app',
  '#4 CACHED',
];
const gwBuildFull = [
  ...gwBuildEarly,
  '#5 [build 3/5] COPY package*.json ./',
  '#5 DONE 0.1s',
  '#6 [build 4/5] RUN npm ci --production',
  '#6 added 189 packages in 6.2s',
  '#6 DONE 6.9s',
  '#7 [build 5/5] COPY . .',
  '#7 DONE 0.2s',
  '#8 [stage-1] COPY --from=build /app/dist ./dist',
  '#8 DONE 0.1s',
  '#9 exporting to image',
  '#9 DONE 0.3s',
];

// ── Reusable full log lines (auth-service) ──
const fullLogLines = [
  '[09:41:01 INF] Application starting...',
  '[09:41:01 INF] Loaded configuration from /app/config/production.json',
  '[09:41:02 INF] Connecting to database: postgres://db:5432/auth',
  '[09:41:02 INF] Database connection established',
  '[09:41:02 INF] Running pending migrations...',
  '[09:41:03 INF] Applied migration: 20250220_add_oauth_scopes',
  '[09:41:03 INF] Starting HTTP server on port 5001',
  '[09:41:03 INF] Registered 18 API endpoints',
  '[09:41:03 INF] Health check endpoint: /health',
  '[09:41:04 INF] Connected to Redis session store at redis:6379',         // 9
  '[09:41:04 INF] OAuth2 providers loaded: google, github, microsoft',
  '[09:41:04 INF] Application started successfully',
  '',
  '[09:42:10 INF] Request starting HTTP/1.1 POST /api/v1/auth/login - null application/json',
  '[09:42:10 INF] Authenticating user: admin@example.com',
  '[09:42:10 INF] Login successful: admin@example.com (session=sess_k8m2)', // 15
  '[09:42:10 INF] Request finished HTTP/1.1 POST /api/v1/auth/login - 200 45.2ms',
  '[09:42:30 INF] Request starting HTTP/1.1 GET /health - null',
  '[09:42:30 INF] Request finished HTTP/1.1 GET /health - 200 0.8ms',
  '[09:43:01 INF] Request starting HTTP/1.1 POST /api/v1/auth/token/refresh - null',
  '[09:43:01 WRN] Token refresh for expired session: sess_old1 (expired 2h ago)', // 20
  '[09:43:01 INF] Request finished HTTP/1.1 POST /api/v1/auth/token/refresh - 401 12.1ms',
  '[09:43:15 INF] Request starting HTTP/1.1 POST /api/v1/auth/oauth/google/callback - null',
  '[09:43:15 INF] OAuth callback: provider=google user=john@gmail.com',
  '[09:43:15 INF] Linking OAuth identity to existing account: usr_8f2k3j',
  '[09:43:15 INF] Request finished HTTP/1.1 POST /api/v1/auth/oauth/google/callback - 200 89.3ms',
  '[09:43:30 INF] Request starting HTTP/1.1 GET /health - null',
  '[09:43:30 INF] Request finished HTTP/1.1 GET /health - 200 0.6ms',
  '[09:44:02 INF] Session cleanup: removed 12 expired sessions',            // 28
  '[09:44:15 INF] Request starting HTTP/1.1 POST /api/v1/auth/login - null application/json',
  '[09:44:15 WRN] Failed login attempt: unknown@evil.com (invalid credentials)',
  '[09:44:15 INF] Request finished HTTP/1.1 POST /api/v1/auth/login - 401 23.4ms',
  '[09:44:30 INF] Request starting HTTP/1.1 GET /health - null',
  '[09:44:30 INF] Request finished HTTP/1.1 GET /health - 200 0.7ms',
  '[09:45:01 INF] Request starting HTTP/1.1 GET /api/v1/auth/sessions - null', // 34
  '[09:45:01 INF] Listing active sessions for user: usr_8f2k3j (3 active)',    // 35
  '[09:45:01 INF] Request finished HTTP/1.1 GET /api/v1/auth/sessions - 200 8.9ms', // 36
  '[09:45:22 ERR] Redis connection lost, attempting reconnect...',
  '[09:45:23 INF] Redis reconnected successfully',
  '[09:45:30 INF] Request starting HTTP/1.1 GET /health - null',
  '[09:45:30 INF] Request finished HTTP/1.1 GET /health - 200 1.2ms',
];

function makeBaseState() {
  const state = createState(config);

  state.groups = [
    {
      file: 'infra/docker-compose.yml',
      label: 'infra',
      services: ['postgres', 'redis', 'rabbitmq', 'minio'],
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

  const mockStatuses: Record<string, { state: string; health: string; createdAt: string; startedAt: string; id: string; ports: Array<{ published: number; target: number }>; workingDir: string | null; worktree: string | null }> = {
    'infra/docker-compose.yml::postgres':  { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc1', ports: [{ published: 5432, target: 5432 }], workingDir: null, worktree: 'main' },
    'infra/docker-compose.yml::redis':     { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc2', ports: [{ published: 6379, target: 6379 }], workingDir: null, worktree: 'main' },
    'infra/docker-compose.yml::rabbitmq':  { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc3', ports: [{ published: 5672, target: 5672 }, { published: 15672, target: 15672 }], workingDir: null, worktree: 'main' },
    'infra/docker-compose.yml::minio':     { state: 'running', health: 'healthy', createdAt: days(14), startedAt: days(3), id: 'abc4', ports: [{ published: 9000, target: 9000 }], workingDir: null, worktree: 'main' },

    'services/docker-compose.yml::api-gateway':          { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc1', ports: [{ published: 8080, target: 8080 }], workingDir: null, worktree: 'main' },
    'services/docker-compose.yml::auth-service':         { state: 'running', health: 'healthy', createdAt: days(1), startedAt: minutes(12), id: 'svc2', ports: [{ published: 5001, target: 5001 }], workingDir: null, worktree: 'fix-oauth' },
    'services/docker-compose.yml::user-service':         { state: 'running', health: 'healthy', createdAt: hours(2), startedAt: hours(2), id: 'svc3', ports: [{ published: 5002, target: 5002 }], workingDir: null, worktree: 'main' },
    'services/docker-compose.yml::billing-service':      { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'svc4', ports: [{ published: 5003, target: 5003 }], workingDir: null, worktree: 'main' },
    'services/docker-compose.yml::notification-service': { state: 'running', health: 'none', createdAt: days(2), startedAt: days(1), id: 'svc5', ports: [{ published: 5004, target: 5004 }], workingDir: null, worktree: 'main' },
    'services/docker-compose.yml::search-service':       { state: 'running', health: 'healthy', createdAt: days(2), startedAt: days(1), id: 'svc6', ports: [{ published: 5005, target: 5005 }], workingDir: null, worktree: 'main' },

    'apps/docker-compose.yml::web-app':          { state: 'running', health: 'healthy', createdAt: hours(2), startedAt: minutes(8), id: 'app1', ports: [{ published: 3000, target: 3000 }], workingDir: null, worktree: 'feat-dashboard' },
    'apps/docker-compose.yml::admin-dashboard':  { state: 'running', health: 'healthy', createdAt: days(3), startedAt: days(1), id: 'app2', ports: [{ published: 3001, target: 3001 }], workingDir: null, worktree: 'main' },
    'apps/docker-compose.yml::worker':           { state: 'running', health: 'healthy', createdAt: days(1), startedAt: days(1), id: 'app3', ports: [], workingDir: null, worktree: 'main' },
  };

  for (const [key, val] of Object.entries(mockStatuses)) {
    state.statuses.set(key, val);
  }

  const mockLogCounts: Record<string, Record<string, number>> = {
    'infra/docker-compose.yml::postgres':  { 'WRN]': 0, 'ERR]': 0 },
    'infra/docker-compose.yml::redis':     { 'WRN]': 0, 'ERR]': 0 },
    'infra/docker-compose.yml::rabbitmq':  { 'WRN]': 0, 'ERR]': 0 },
    'infra/docker-compose.yml::minio':     { 'WRN]': 12, 'ERR]': 0 },
    'services/docker-compose.yml::api-gateway':          { 'WRN]': 156, 'ERR]': 0 },
    'services/docker-compose.yml::auth-service':         { 'WRN]': 21, 'ERR]': 0 },
    'services/docker-compose.yml::user-service':         { 'WRN]': 8, 'ERR]': 2 },
    'services/docker-compose.yml::billing-service':      { 'WRN]': 0, 'ERR]': 0 },
    'services/docker-compose.yml::notification-service': { 'WRN]': 0, 'ERR]': 0 },
    'services/docker-compose.yml::search-service':       { 'WRN]': 34, 'ERR]': 0 },
    'apps/docker-compose.yml::web-app':          { 'WRN]': 29, 'ERR]': 0 },
    'apps/docker-compose.yml::admin-dashboard':  { 'WRN]': 0, 'ERR]': 0 },
    'apps/docker-compose.yml::worker':           { 'WRN]': 7, 'ERR]': 0 },
  };

  for (const [key, counts] of Object.entries(mockLogCounts)) {
    const m = new Map<string, number>();
    for (const [p, c] of Object.entries(counts)) m.set(p, c);
    state.logCounts.set(key, m);
  }

  const mockStats: Record<string, { cpuPercent: number; memUsageBytes: number }> = {
    'infra/docker-compose.yml::postgres':  { cpuPercent: 3.2, memUsageBytes: 256 * 1024 * 1024 },
    'infra/docker-compose.yml::redis':     { cpuPercent: 0.8, memUsageBytes: 42 * 1024 * 1024 },
    'infra/docker-compose.yml::rabbitmq':  { cpuPercent: 1.5, memUsageBytes: 178 * 1024 * 1024 },
    'infra/docker-compose.yml::minio':     { cpuPercent: 0.3, memUsageBytes: 95 * 1024 * 1024 },
    'services/docker-compose.yml::api-gateway':          { cpuPercent: 8.7, memUsageBytes: 312 * 1024 * 1024 },
    'services/docker-compose.yml::auth-service':         { cpuPercent: 2.1, memUsageBytes: 128 * 1024 * 1024 },
    'services/docker-compose.yml::user-service':         { cpuPercent: 4.3, memUsageBytes: 195 * 1024 * 1024 },
    'services/docker-compose.yml::billing-service':      { cpuPercent: 1.0, memUsageBytes: 87 * 1024 * 1024 },
    'services/docker-compose.yml::notification-service': { cpuPercent: 0.2, memUsageBytes: 45 * 1024 * 1024 },
    'services/docker-compose.yml::search-service':       { cpuPercent: 55.2, memUsageBytes: 620 * 1024 * 1024 },
    'apps/docker-compose.yml::web-app':          { cpuPercent: 6.1, memUsageBytes: 234 * 1024 * 1024 },
    'apps/docker-compose.yml::admin-dashboard':  { cpuPercent: 0.5, memUsageBytes: 67 * 1024 * 1024 },
    'apps/docker-compose.yml::worker':           { cpuPercent: 22.3, memUsageBytes: 1.2 * 1024 * 1024 * 1024 },
  };

  for (const [key, val] of Object.entries(mockStats)) {
    state.containerStats.set(key, val);
  }

  state.showWorktreeColumn = true;
  state.scrollOffset = 0;

  state.watching.set('apps/docker-compose.yml::web-app', mockKillable);
  state.watching.set('services/docker-compose.yml::api-gateway', mockKillable);

  return state;
}

// Helper: set api-gateway worktree to feat-rate-limiting
function switchGwWorktree(state: ReturnType<typeof makeBaseState>) {
  const gwSk = statusKey('services/docker-compose.yml', 'api-gateway');
  const gwStatus = state.statuses.get(gwSk);
  if (gwStatus) {
    state.statuses.set(gwSk, { ...gwStatus, worktree: 'feat-rate-limiting' });
  }
}

const TOTAL_FRAMES = 18;
const frame = parseInt(process.argv[2] || '1', 10);
if (frame < 1 || frame > TOTAL_FRAMES) {
  console.error(`Unknown frame: ${frame}. Use 1-${TOTAL_FRAMES}.`);
  process.exit(1);
}

const state = makeBaseState();
const authSk = statusKey('services/docker-compose.yml', 'auth-service');
const gwSk = statusKey('services/docker-compose.yml', 'api-gateway');

switch (frame) {
  // ── 1: Initial list view, cursor on api-gateway ──
  case 1: {
    state.cursor = 4;
    state.showBottomLogs = false;
    break;
  }

  // ── 2: Navigate down to auth-service (j) ──
  case 2: {
    state.cursor = 5;
    state.showBottomLogs = false;
    break;
  }

  // ── 3: Rebuilding auth-service — first batch of build logs ──
  case 3: {
    state.cursor = 5;
    state.rebuilding.set(authSk, mockKillable);
    state.showBottomLogs = true;
    state.bottomLogLines.set(authSk, {
      action: 'rebuilding',
      service: 'auth-service',
      lines: authBuildEarly,
    });
    break;
  }

  // ── 4: Rebuilding auth-service — full build logs ──
  case 4: {
    state.cursor = 5;
    state.rebuilding.set(authSk, mockKillable);
    state.showBottomLogs = true;
    state.bottomLogLines.set(authSk, {
      action: 'rebuilding',
      service: 'auth-service',
      lines: authBuildFull,
    });
    break;
  }

  // ── 5: Full screen logs for auth-service (f) ──
  case 5: {
    state.cursor = 5;
    state.mode = MODE.LOGS;
    state.logAutoScroll = true;
    state.logScrollOffset = 0;
    state.logLines = fullLogLines;
    break;
  }

  // ── 6: Search prompt active — typed "/ses" ──
  case 6: {
    state.cursor = 5;
    state.mode = MODE.LOGS;
    state.logAutoScroll = false;
    state.logScrollOffset = 0;
    state.logLines = fullLogLines;
    state.logSearchActive = true;
    state.logSearchQuery = 'ses';
    break;
  }

  // ── 7: Search prompt — typed "/session" ──
  case 7: {
    state.cursor = 5;
    state.mode = MODE.LOGS;
    state.logAutoScroll = false;
    state.logScrollOffset = 0;
    state.logLines = fullLogLines;
    state.logSearchActive = true;
    state.logSearchQuery = 'session';
    break;
  }

  // ── 8: Search submitted — "session" matches highlighted ──
  case 8: {
    state.cursor = 5;
    state.mode = MODE.LOGS;
    state.logAutoScroll = false;
    state.logScrollOffset = 0;
    state.logLines = fullLogLines;
    state.logSearchQuery = 'session';
    state.logSearchActive = false;
    state.logSearchMatches = [9, 15, 20, 28, 34, 35, 36];
    state.logSearchMatchIdx = 6;
    break;
  }

  // ── 9: Back to list, cursor on api-gateway, bottom logs ──
  case 9: {
    state.cursor = 4;
    state.showBottomLogs = true;
    state.bottomLogLines.set(gwSk, {
      action: 'logs',
      service: 'api-gateway',
      lines: [
        '[14:09:10 INF] Proxying POST /api/v1/auth/login -> auth-service:5001',
        '[14:09:10 INF] Response 200 in 48ms',
        '[14:09:22 INF] Proxying GET /api/v1/users?page=1 -> user-service:5002',
        '[14:09:22 INF] Response 200 in 52ms',
        '[14:09:45 INF] Request starting HTTP/1.1 GET /health - null',
        '[14:09:45 INF] Request finished HTTP/1.1 GET /health - 200 0.4ms',
        '[14:10:01 WRN] Upstream timeout: search-service:5005 (>5000ms)',
        '[14:10:15 INF] Proxying GET /api/v1/users/me -> user-service:5002',
        '[14:10:15 INF] Response 200 in 15ms',
        '[14:10:30 INF] Rate limit check: 10.0.3.42 - 45/100 requests',
      ],
    });
    break;
  }

  // ── 10: Worktree picker opened — main highlighted (cursor 0) ──
  case 10: {
    state.cursor = 4;
    state.showBottomLogs = false;
    state.worktreePickerActive = true;
    state.worktreePickerCursor = 0;
    state.worktreePickerEntries = [
      { branch: 'main', path: '/home/dev/project' },
      { branch: 'feat-rate-limiting', path: '/home/dev/project-rate-limiting' },
      { branch: 'fix-cors', path: '/home/dev/project-cors' },
    ];
    state.worktreePickerCurrentPath = '/home/dev/project';
    break;
  }

  // ── 11: Worktree picker — navigated to feat-rate-limiting (cursor 1) ──
  case 11: {
    state.cursor = 4;
    state.showBottomLogs = false;
    state.worktreePickerActive = true;
    state.worktreePickerCursor = 1;
    state.worktreePickerEntries = [
      { branch: 'main', path: '/home/dev/project' },
      { branch: 'feat-rate-limiting', path: '/home/dev/project-rate-limiting' },
      { branch: 'fix-cors', path: '/home/dev/project-cors' },
    ];
    state.worktreePickerCurrentPath = '/home/dev/project';
    break;
  }

  // ── 12: Worktree switched + rebuilding api-gateway — few lines ──
  case 12: {
    state.cursor = 4;
    switchGwWorktree(state);
    state.rebuilding.set(gwSk, mockKillable);
    state.showBottomLogs = true;
    state.bottomLogLines.set(gwSk, {
      action: 'rebuilding',
      service: 'api-gateway',
      lines: gwBuildEarly,
    });
    break;
  }

  // ── 13: Rebuilding api-gateway — full logs ──
  case 13: {
    state.cursor = 4;
    switchGwWorktree(state);
    state.rebuilding.set(gwSk, mockKillable);
    state.showBottomLogs = true;
    state.bottomLogLines.set(gwSk, {
      action: 'rebuilding',
      service: 'api-gateway',
      lines: gwBuildFull,
    });
    break;
  }

  // ── 14: Navigate down to auth-service (j) ──
  case 14: {
    state.cursor = 5;
    state.showBottomLogs = false;
    switchGwWorktree(state);
    break;
  }

  // ── 15: Navigate down to user-service (j) ──
  case 15: {
    state.cursor = 6;
    state.showBottomLogs = false;
    switchGwWorktree(state);
    break;
  }

  // ── 16: Open exec inline on user-service (e) ──
  case 16: {
    state.cursor = 6;
    switchGwWorktree(state);
    state.execActive = true;
    state.execService = 'user-service';
    state.execContainerId = 'svc3';
    state.execInput = '';
    state.execHistory = [];
    state.execOutputLines = [];
    break;
  }

  // ── 17: Exec — typing "pwd" ──
  case 17: {
    state.cursor = 6;
    switchGwWorktree(state);
    state.execActive = true;
    state.execService = 'user-service';
    state.execContainerId = 'svc3';
    state.execInput = 'pwd';
    state.execHistory = [];
    state.execOutputLines = [];
    break;
  }

  // ── 18: Exec — pwd result ──
  case 18: {
    state.cursor = 6;
    switchGwWorktree(state);
    state.execActive = true;
    state.execService = 'user-service';
    state.execContainerId = 'svc3';
    state.execInput = '';
    state.execHistory = ['pwd'];
    state.execOutputLines = [
      '$ pwd',
      '/app',
    ];
    break;
  }
}

// --- Render ---
let output = clearScreen();
if (state.mode === MODE.LOGS) {
  output += renderLogView(state);
} else {
  output += renderListView(state);
}

// termshot does not render REVERSE (\x1b[7m); replace with BG_HIGHLIGHT + white fg
output = output.replace(/\x1b\[7m/g, '\x1b[48;5;237m\x1b[37m');

process.stdout.write(output);
process.stdout.write('\x1b[?25h');
