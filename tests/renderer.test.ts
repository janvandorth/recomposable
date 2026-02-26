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
} from '../src/lib/renderer';
import { createTestState, createMockStatus, createMockKillable } from './helpers';
import { statusKey } from '../src/lib/state';

// Strip ANSI helper for test assertions
function strip(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

describe('clearScreen', () => {
  it('returns escape sequences for clearing screen and hiding cursor', () => {
    const result = clearScreen();
    expect(result).toContain('\x1b[2J');
    expect(result).toContain('\x1b[H');
    expect(result).toContain('\x1b[?25l');
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
    // Cursor row should contain REVERSE escape
    expect(output).toContain('\x1b[7m');
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

  it('shows search match info in bottom panel', () => {
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
    const output = renderListView(state);
    const text = strip(output);
    expect(text).toContain('search: "error" (2 matches)');
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

  it('shows paused status when not auto-scrolling', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logAutoScroll = false;
    state.logScrollOffset = 5;
    state.logLines = Array(20).fill('log line');
    const output = renderLogView(state);
    const text = strip(output);
    expect(text).toContain('paused');
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
});
