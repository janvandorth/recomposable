import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearScreen,
  showCursor,
  visLen,
  padVisible,
  padVisibleStart,
  formatMem,
  relativeTime,
  statusIcon,
  statusText,
  renderLegend,
  renderListView,
  renderLogView,
  truncateLine,
  highlightSearchInLine,
  wrapPlainLine,
} from '../src/lib/renderer';
import { createTestState, createMockStatus, createMockKillable } from './helpers';
import { statusKey } from '../src/lib/state';

// Strip ANSI helper for test assertions
function strip(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

describe('clearScreen', () => {
  it('returns escape sequences for cursor home and hiding cursor without full clear', () => {
    const result = clearScreen();
    expect(result).toContain('\x1b[H');
    expect(result).toContain('\x1b[?25l');
    expect(result).not.toContain('\x1b[2J');
  });
});

describe('showCursor', () => {
  it('returns escape sequence for showing cursor', () => {
    expect(showCursor()).toBe('\x1b[?25h');
  });
});

describe('visLen', () => {
  it('returns length for plain strings', () => {
    expect(visLen('hello')).toBe(5);
  });

  it('strips ANSI codes for length calculation', () => {
    expect(visLen('\x1b[31mhello\x1b[0m')).toBe(5);
  });

  it('handles empty string', () => {
    expect(visLen('')).toBe(0);
  });

  it('handles multiple ANSI codes', () => {
    expect(visLen('\x1b[1m\x1b[32mtest\x1b[0m')).toBe(4);
  });
});

describe('padVisible', () => {
  it('pads plain string to correct width', () => {
    expect(padVisible('abc', 6)).toBe('abc   ');
  });

  it('pads ANSI string to correct visual width', () => {
    const result = padVisible('\x1b[31mhi\x1b[0m', 5);
    expect(visLen(result)).toBe(5);
  });

  it('does not truncate if already longer', () => {
    const result = padVisible('hello world', 5);
    expect(result).toBe('hello world');
  });
});

describe('padVisibleStart', () => {
  it('left-pads plain string to correct width', () => {
    expect(padVisibleStart('abc', 6)).toBe('   abc');
  });

  it('left-pads ANSI string to correct visual width', () => {
    const result = padVisibleStart('\x1b[31m5\x1b[0m', 4);
    expect(visLen(result)).toBe(4);
  });
});

describe('formatMem', () => {
  it('formats bytes < 1MB as K', () => {
    expect(formatMem(512 * 1024)).toBe('512K');
  });

  it('formats bytes < 1GB as M', () => {
    expect(formatMem(256 * 1024 * 1024)).toBe('256M');
  });

  it('formats bytes >= 1GB as G with one decimal', () => {
    expect(formatMem(1.5 * 1024 * 1024 * 1024)).toBe('1.5G');
  });

  it('returns - for zero', () => {
    expect(formatMem(0)).toBe('-');
  });

  it('returns - for negative', () => {
    expect(formatMem(-100)).toBe('-');
  });
});

describe('relativeTime', () => {
  it('formats seconds ago', () => {
    const ts = new Date(Date.now() - 30000).toISOString();
    const result = strip(relativeTime(ts));
    expect(result).toBe('30s ago');
  });

  it('formats minutes ago', () => {
    const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = strip(relativeTime(ts));
    expect(result).toBe('5m ago');
  });

  it('formats hours ago', () => {
    const ts = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const result = strip(relativeTime(ts));
    expect(result).toBe('3h ago');
  });

  it('formats days ago', () => {
    const ts = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const result = strip(relativeTime(ts));
    expect(result).toBe('2d ago');
  });

  it('returns - for null', () => {
    const result = strip(relativeTime(null));
    expect(result).toBe('-');
  });

  it('returns - for undefined', () => {
    const result = strip(relativeTime(undefined));
    expect(result).toBe('-');
  });
});

describe('statusIcon', () => {
  it('shows green for running healthy', () => {
    const result = statusIcon({ state: 'running', health: 'healthy' }, false, false, false, false);
    expect(result).toContain('\u25CF'); // filled circle
    expect(result).toContain('32m'); // green
  });

  it('shows red for running unhealthy', () => {
    const result = statusIcon({ state: 'running', health: 'unhealthy' }, false, false, false, false);
    expect(result).toContain('\u25CF');
    expect(result).toContain('31m'); // red
  });

  it('shows yellow for rebuilding', () => {
    const result = statusIcon({ state: 'running', health: 'healthy' }, true, false, false, false);
    expect(result).toContain('\u25CF');
    expect(result).toContain('33m'); // yellow
  });

  it('shows yellow for restarting', () => {
    const result = statusIcon(null, false, true, false, false);
    expect(result).toContain('33m');
  });

  it('shows yellow for stopping', () => {
    const result = statusIcon(null, false, false, true, false);
    expect(result).toContain('33m');
  });

  it('shows yellow for starting', () => {
    const result = statusIcon(null, false, false, false, true);
    expect(result).toContain('33m');
  });

  it('shows gray circle for stopped', () => {
    const result = statusIcon(null, false, false, false, false);
    expect(result).toContain('\u25CB'); // empty circle
    expect(result).toContain('90m'); // gray
  });

  it('shows yellow for docker restarting state', () => {
    const result = statusIcon({ state: 'restarting', health: '' }, false, false, false, false);
    expect(result).toContain('33m');
  });
});

describe('statusText', () => {
  it('shows STOPPING for stopping state', () => {
    expect(strip(statusText(null, false, false, true, false))).toBe('STOPPING...');
  });

  it('shows STARTING for starting state', () => {
    expect(strip(statusText(null, false, false, false, true))).toBe('STARTING...');
  });

  it('shows RESTARTING for restarting state', () => {
    expect(strip(statusText(null, false, true, false, false))).toBe('RESTARTING...');
  });

  it('shows REBUILDING for rebuilding state', () => {
    expect(strip(statusText(null, true, false, false, false))).toBe('REBUILDING...');
  });

  it('shows stopped for null status', () => {
    expect(strip(statusText(null, false, false, false, false))).toBe('stopped');
  });

  it('shows running (healthy) with green', () => {
    const result = statusText({ state: 'running', health: 'healthy' }, false, false, false, false);
    expect(strip(result)).toBe('running (healthy)');
    expect(result).toContain('32m');
  });

  it('shows running (unhealthy) with red', () => {
    const result = statusText({ state: 'running', health: 'unhealthy' }, false, false, false, false);
    expect(strip(result)).toBe('running (unhealthy)');
    expect(result).toContain('31m');
  });

  it('shows exited with gray', () => {
    const result = statusText({ state: 'exited', health: '' }, false, false, false, false);
    expect(strip(result)).toBe('exited');
    expect(result).toContain('90m');
  });

  it('omits health when none or empty', () => {
    expect(strip(statusText({ state: 'running', health: 'none' }, false, false, false, false))).toBe('running');
    expect(strip(statusText({ state: 'running', health: '' }, false, false, false, false))).toBe('running');
  });
});

describe('renderLegend', () => {
  it('renders list mode legend by default', () => {
    const result = strip(renderLegend());
    expect(result).toContain('Re[B]uild');
    expect(result).toContain('[S]tart/restart');
    expect(result).toContain('[Q]uit');
  });

  it('renders logs scroll mode legend', () => {
    const result = strip(renderLegend({ logsScrollMode: true }));
    expect(result).toContain('[Esc] back');
    expect(result).toContain('[j/k] scroll');
    expect(result).toContain('[/] search');
  });

  it('highlights active indicators', () => {
    const result = renderLegend({ noCacheActive: true });
    // Active items use BG_HIGHLIGHT
    expect(result).toContain('48;5;237m');
  });

  it('highlights log panel when active', () => {
    const result = renderLegend({ logPanelActive: true });
    expect(result).toContain('48;5;237m');
  });
});

describe('renderListView', () => {
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
    process.stdout.columns = 120;
    process.stdout.rows = 40;
  });

  afterEach(() => {
    process.stdout.columns = originalColumns!;
    process.stdout.rows = originalRows!;
  });

  it('renders logo, separator, legend, groups, and services', () => {
    const state = createTestState();
    const output = renderListView(state);
    const lines = output.split('\n');
    const text = strip(output);

    expect(text).toContain('docker compose manager');
    expect(text).toContain('docker compose manager');
    expect(text).toContain('infra');
    expect(text).toContain('services');
    expect(text).toContain('postgres');
    expect(text).toContain('api-gateway');
  });

  it('shows cursor highlight on selected service', () => {
    const state = createTestState();
    state.cursor = 0;
    const output = renderListView(state);
    // Cursor row should contain BG_HIGHLIGHT for full-row highlight
    expect(output).toContain('\x1b[48;5;237m');
  });

  it('shows CPU/MEM for running services with stats', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.containerStats.set(sk, { cpuPercent: 5.3, memUsageBytes: 256 * 1024 * 1024 });
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('5.3%');
    expect(text).toContain('256M');
  });

  it('shows CPU/MEM with warn color', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.containerStats.set(sk, { cpuPercent: 75, memUsageBytes: 100 * 1024 * 1024 });
    const output = renderListView(state);
    // Should contain yellow color
    expect(output).toContain('33m');
  });

  it('shows CPU/MEM with danger color', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.containerStats.set(sk, { cpuPercent: 150, memUsageBytes: 100 * 1024 * 1024 });
    const output = renderListView(state);
    expect(output).toContain('31m'); // red
  });

  it('shows ports', () => {
    const state = createTestState();
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('8080');
  });

  it('renders bottom log panel when enabled', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['log line 1', 'log line 2'],
    });
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('logs postgres');
    expect(text).toContain('log line 1');
    expect(text).toContain('log line 2');
  });

  it('hides bottom panel when disabled', () => {
    const state = createTestState();
    state.showBottomLogs = false;
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['should not appear'],
    });
    const output = renderListView(state);
    const text = strip(output);
    expect(text).not.toContain('should not appear');
  });

  it('shows group error', () => {
    const state = createTestState();
    state.groups[0].error = 'file not found';
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('file not found');
  });

  it('shows search match info in bottom panel from full log', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['error occurred', 'all good', 'another error here'],
    });
    state.bottomSearchQuery = 'error';
    state.bottomSearchActive = false;
    state.bottomSearchTotalMatches = 42;
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('search: "error" (42 matches in full log)');
  });

  it('shows searching indicator while loading', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['line 1'],
    });
    state.bottomSearchQuery = 'error';
    state.bottomSearchActive = false;
    state.bottomSearchLoading = true;
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('searching "error"...');
  });

  it('shows WORKTREE column when showWorktreeColumn is true', () => {
    const state = createTestState();
    state.showWorktreeColumn = true;
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.statuses.set(sk, createMockStatus({ worktree: 'fix-bug' }));
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('WORKTREE');
    expect(text).toContain('fix-bug');
  });

  it('hides WORKTREE column when showWorktreeColumn is false', () => {
    const state = createTestState();
    state.showWorktreeColumn = false;
    const output = renderListView(state);
    const text = strip(output);
    expect(text).not.toContain('WORKTREE');
  });

  it('shows rebuilding status for service', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.rebuilding.set(sk, createMockKillable());
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('REBUILDING...');
  });

  it('renders search prompt when bottomSearchActive', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['test log'],
    });
    state.bottomSearchActive = true;
    state.bottomSearchQuery = 'err';
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('/err_');
  });

  it('highlights log scan patterns in bottom panel', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['something WRN] warning here'],
    });
    const output = renderListView(state);
    // WRN] should be colored (yellow = 33m)
    expect(output).toContain('33m');
    expect(output).toContain('WRN]');
  });

  it('colors entire line yellow for WRN pattern in bottom panel', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['2024-01-01 WRN] something happened'],
    });
    const output = renderListView(state);
    // The line should start with yellow (33m), not gray (90m)
    expect(output).toContain('\x1b[33m2024-01-01 WRN]');
  });

  it('colors entire line red for ERR pattern in bottom panel', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['2024-01-01 ERR] something broke'],
    });
    const output = renderListView(state);
    // The line should start with red (31m)
    expect(output).toContain('\x1b[31m2024-01-01 ERR]');
  });

  it('keeps gray for lines without any pattern in bottom panel', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['2024-01-01 INF] all good'],
    });
    const output = renderListView(state);
    // The line should start with gray (90m)
    expect(output).toContain('\x1b[90m2024-01-01 INF]');
  });

  it('shows service name always in white regardless of worktree', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.statuses.set(sk, createMockStatus({ worktree: 'fix-bug' }));
    const output = renderListView(state);
    // Service name should always use white (37m)
    expect(output).toContain('\x1b[37mpostgres');
  });

  it('shows worktree column in yellow when worktree is not main', () => {
    const state = createTestState();
    state.showWorktreeColumn = true;
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.statuses.set(sk, createMockStatus({ worktree: 'fix-bug' }));
    const output = renderListView(state);
    // Worktree column should use yellow (33m) for non-main
    expect(output).toContain('\x1b[33mfix-bug');
  });

  it('shows worktree column dimmed when worktree is main', () => {
    const state = createTestState();
    state.showWorktreeColumn = true;
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.statuses.set(sk, createMockStatus({ worktree: 'main' }));
    const output = renderListView(state);
    // Worktree column on selected row promotes DIM to white (37m)
    expect(output).toContain('\x1b[37mmain');
  });

  it('highlights entire selected row with background color', () => {
    const state = createTestState();
    state.cursor = 0;
    const output = renderListView(state);
    const lines = output.split('\n');
    // Find the line containing postgres (cursor=0, first service)
    const pgLine = lines.find(l => strip(l).includes('postgres'));
    expect(pgLine).toBeDefined();
    // Should start with BG_HIGHLIGHT and end with RESET
    expect(pgLine).toContain('\x1b[48;5;237m');
    // The background should be re-applied after resets within the row
    const bgCount = (pgLine!.match(/\x1b\[48;5;237m/g) || []).length;
    expect(bgCount).toBeGreaterThan(1);
  });
});

describe('bottom panel shows limited lines', () => {
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
    process.stdout.columns = 120;
    process.stdout.rows = 40;
  });

  afterEach(() => {
    process.stdout.columns = originalColumns!;
    process.stdout.rows = originalRows!;
  });

  it('shows only last N lines when more lines are stored', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    const lines = Array.from({ length: 25 }, (_, i) => `build line ${i + 1}`);
    state.bottomLogLines.set(sk, {
      action: 'rebuilding',
      service: 'postgres',
      lines,
    });
    const output = renderListView(state);
    const text = strip(output);
    // Should show last 10 lines (default bottomLogCount)
    expect(text).toContain('build line 25');
    expect(text).toContain('build line 16');
    expect(text).not.toContain('build line 15');
  });
});

describe('renderLogView build status header', () => {
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
    process.stdout.columns = 120;
    process.stdout.rows = 30;
  });

  afterEach(() => {
    process.stdout.columns = originalColumns!;
    process.stdout.rows = originalRows!;
  });

  it('shows "rebuilding" header when logBuildKey is set and service is rebuilding', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.logBuildKey = sk;
    state.rebuilding.set(sk, createMockKillable());
    state.bottomLogLines.set(sk, { action: 'rebuilding', service: 'postgres', lines: [] });
    state.logLines = ['build output line'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('rebuilding postgres');
    expect(text).not.toContain('full logs');
  });

  it('shows "build failed" header when logBuildKey is set and build failed', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.logBuildKey = sk;
    state.bottomLogLines.set(sk, { action: 'build_failed', service: 'postgres', lines: [] });
    state.logLines = ['error output'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('build failed postgres');
    expect(text).not.toContain('full logs');
  });

  it('shows "full logs" header when logBuildKey is null', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logBuildKey = null;
    state.logLines = ['runtime log'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('full logs postgres');
  });
});

describe('truncateLine', () => {
  it('returns short strings unchanged', () => {
    expect(truncateLine('hello', 10)).toBe('hello');
  });

  it('truncates at visual width', () => {
    const result = truncateLine('hello world', 5);
    expect(strip(result)).toBe('hello');
  });

  it('handles ANSI sequences correctly', () => {
    const input = '\x1b[31mhello world\x1b[0m';
    const result = truncateLine(input, 5);
    // Should include the ANSI code but only 5 visible chars
    expect(strip(result)).toBe('hello');
  });

  it('does not truncate if exact width', () => {
    expect(truncateLine('exact', 5)).toBe('exact');
  });
});

describe('highlightSearchInLine', () => {
  it('returns unchanged line for empty query', () => {
    expect(highlightSearchInLine('test line', '')).toBe('test line');
  });

  it('highlights matching text case-insensitively', () => {
    const result = highlightSearchInLine('Hello World', 'hello');
    expect(result).toContain('\x1b[7m'); // REVERSE
    expect(result).toContain('33m'); // YELLOW
    expect(strip(result)).toBe('Hello World');
  });

  it('highlights multiple matches', () => {
    const result = highlightSearchInLine('test test test', 'test');
    const matches = result.split('\x1b[7m').length - 1;
    expect(matches).toBe(3);
  });

  it('handles no matches', () => {
    const result = highlightSearchInLine('hello world', 'xyz');
    expect(result).toBe('hello world');
  });
});

describe('wrapPlainLine', () => {
  it('returns short lines unchanged', () => {
    expect(wrapPlainLine('hello', 80)).toEqual(['hello']);
  });

  it('wraps long lines into chunks', () => {
    expect(wrapPlainLine('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('handles exact width', () => {
    expect(wrapPlainLine('abcd', 4)).toEqual(['abcd']);
  });

  it('handles empty string', () => {
    expect(wrapPlainLine('', 80)).toEqual(['']);
  });

  it('handles width of 0', () => {
    expect(wrapPlainLine('test', 0)).toEqual(['test']);
  });
});

describe('renderLogView', () => {
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
    process.stdout.columns = 120;
    process.stdout.rows = 30;
  });

  afterEach(() => {
    process.stdout.columns = originalColumns!;
    process.stdout.rows = originalRows!;
  });

  it('renders logo and log view legend', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['line 1', 'line 2'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('docker compose manager');
    expect(text).toContain('[Esc] back');
    expect(text).toContain('[j/k] scroll');
  });

  it('shows auto-scroll status as live', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logAutoScroll = true;
    state.logLines = ['line 1'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('live');
  });

  it('shows paused status with percentage when not auto-scrolling', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logAutoScroll = false;
    state.logScrollOffset = 5;
    state.logLines = Array(20).fill('log line');
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('paused');
    expect(text).toContain('line 15 / 20 (75%)');
  });

  it('shows clear search in legend when search is active', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['match here', 'no match'];
    state.logSearchQuery = 'match';
    state.logSearchMatches = [0];
    state.logSearchMatchIdx = 0;
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('[Esc] clear search');
  });

  it('shows [Esc] back in legend when no search', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['test'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('[Esc] back');
  });

  it('shows search match count', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['match here', 'no match', 'match here too'];
    state.logSearchQuery = 'match';
    state.logSearchMatches = [0, 2];
    state.logSearchMatchIdx = 0;
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('match 1/2');
  });

  it('shows no matches message', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['test line'];
    state.logSearchQuery = 'notfound';
    state.logSearchMatches = [];
    state.logSearchMatchIdx = -1;
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('no matches');
  });

  it('renders search prompt when active', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['test'];
    state.logSearchActive = true;
    state.logSearchQuery = 'err';
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('/err_');
  });

  it('shows service name', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.cursor = 0;
    state.logLines = ['test'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('postgres');
  });

  it('displays log lines', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['line A', 'line B', 'line C'];
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('line A');
    expect(text).toContain('line B');
    expect(text).toContain('line C');
  });

  it('wraps long log lines instead of truncating', () => {
    process.stdout.columns = 20;
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['a'.repeat(35)]; // 35 chars, should wrap at 20
    const output = renderLogView(state);
    const text = strip(output);
    // Both the first chunk and the wrapped remainder should appear
    expect(text).toContain('a'.repeat(20));
    expect(text).toContain('a'.repeat(15));
  });

  it('shows loading history indicator', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['test'];
    state.logHistoryLoading = true;
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('loading history...');
  });

  it('colors WRN lines yellow in full log view', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['2024-01-01 WRN] something happened'];
    const output = renderLogView(state);
    expect(output).toContain('\x1b[33m2024-01-01 WRN]');
  });

  it('colors ERR lines red in full log view', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['2024-01-01 ERR] something broke'];
    const output = renderLogView(state);
    expect(output).toContain('\x1b[31m2024-01-01 ERR]');
  });

  it('does not color normal lines in full log view', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['2024-01-01 INF] all good'];
    const output = renderLogView(state);
    // Should not contain yellow or red color codes wrapping the line
    expect(output).not.toContain('\x1b[33m2024-01-01 INF]');
    expect(output).not.toContain('\x1b[31m2024-01-01 INF]');
  });
});

describe('renderLegend - worktree picker', () => {
  it('shows picker keys when worktreePickerActive', () => {
    const result = strip(renderLegend({ worktreePickerActive: true }));
    expect(result).toContain('[Esc] cancel');
    expect(result).toContain('[Enter] switch');
    expect(result).toContain('[j/k] navigate');
    expect(result).not.toContain('Re[B]uild');
  });

  it('shows [T]ree in default list legend', () => {
    const result = strip(renderLegend());
    expect(result).toContain('Switch [t]ree');
  });
});

describe('renderListView - worktree picker overlay', () => {
  let originalColumns: number | undefined;
  let originalRows: number | undefined;

  beforeEach(() => {
    originalColumns = process.stdout.columns;
    originalRows = process.stdout.rows;
    Object.defineProperty(process.stdout, 'columns', { value: 120, writable: true, configurable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 40, writable: true, configurable: true });
  });

  afterEach(() => {
    if (originalColumns !== undefined) {
      Object.defineProperty(process.stdout, 'columns', { value: originalColumns, writable: true, configurable: true });
    }
    if (originalRows !== undefined) {
      Object.defineProperty(process.stdout, 'rows', { value: originalRows, writable: true, configurable: true });
    }
  });

  it('shows picker UI when worktreePickerActive', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/home/user/main', branch: 'main' },
      { path: '/home/user/fix', branch: 'fix-bug' },
    ];
    state.worktreePickerCursor = 1;
    state.worktreePickerCurrentPath = '/home/user/main';
    const output = strip(renderListView(state));
    expect(output).toContain('switch worktree');
    expect(output).toContain('main');
    expect(output).toContain('fix-bug');
    expect(output).toContain('(current)');
  });

  it('shows picker legend when picker is active', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
    ];
    state.worktreePickerCursor = 0;
    const output = strip(renderListView(state));
    expect(output).toContain('[Esc] cancel');
    expect(output).toContain('[Enter] switch');
  });

  it('shows service name in picker header', () => {
    const state = createTestState();
    state.cursor = 2; // 'api-gateway'
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
    ];
    state.worktreePickerCursor = 0;
    const output = strip(renderListView(state));
    expect(output).toContain('switch worktree api-gateway');
  });

  it('marks current worktree', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/home/user/project', branch: 'main' },
      { path: '/home/user/project-fix', branch: 'fix-bug' },
    ];
    state.worktreePickerCursor = 0;
    state.worktreePickerCurrentPath = '/home/user/project';
    const output = strip(renderListView(state));
    expect(output).toContain('(current)');
  });

  it('does not mark non-current worktree as current', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/home/user/project', branch: 'main' },
      { path: '/home/user/project-fix', branch: 'fix-bug' },
    ];
    state.worktreePickerCursor = 0;
    state.worktreePickerCurrentPath = '/home/user/project';
    const output = strip(renderListView(state));
    // Only one "(current)" tag
    const matches = output.match(/\(current\)/g);
    expect(matches).toHaveLength(1);
  });

  it('shows switching action in bottom panel', () => {
    const state = createTestState();
    const entry = state.flatList[state.cursor];
    const sk = statusKey(entry.file, entry.service);
    state.bottomLogLines.set(sk, { action: 'switching', service: entry.service, lines: ['switching to worktree "fix-bug"...'] });
    state.showBottomLogs = true;
    const output = strip(renderListView(state));
    expect(output).toContain('switching');
  });

  it('shows switch_failed action in bottom panel', () => {
    const state = createTestState();
    const entry = state.flatList[state.cursor];
    const sk = statusKey(entry.file, entry.service);
    state.bottomLogLines.set(sk, { action: 'switch_failed', service: entry.service, lines: ['compose file not found'] });
    state.showBottomLogs = true;
    const output = strip(renderListView(state));
    expect(output).toContain('SWITCH FAILED');
  });
});
