import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestState, createTestConfig, createMockKillable } from './helpers';
import { createState, statusKey, buildFlatList, moveCursor, selectedEntry, MODE } from '../src/lib/state';
import type { AppState, Config } from '../src/lib/types';

// We test pure/testable functions from index.ts.
// For functions that call docker/renderer, we mock them.

// Mock docker and renderer modules for index tests
const mockChildProcess = () => ({
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
});

vi.mock('../src/lib/docker', () => ({
  listServices: vi.fn(),
  getStatuses: vi.fn(() => new Map()),
  rebuildService: vi.fn(() => mockChildProcess()),
  restartService: vi.fn(() => mockChildProcess()),
  stopService: vi.fn(() => mockChildProcess()),
  startService: vi.fn(() => mockChildProcess()),
  tailLogs: vi.fn(() => mockChildProcess()),
  fetchServiceLogs: vi.fn(() => mockChildProcess()),
  getContainerId: vi.fn(() => null),
  tailContainerLogs: vi.fn(() => mockChildProcess()),
  fetchContainerLogs: vi.fn(() => mockChildProcess()),
  fetchContainerStats: vi.fn(() => mockChildProcess()),
  parseStatsLine: vi.fn(),
  parseMemString: vi.fn(),
  isWatchAvailable: vi.fn(() => true),
  watchService: vi.fn(() => mockChildProcess()),
  parseDependencyGraph: vi.fn(() => ({ dependsOn: new Map(), dependedBy: new Map() })),
  execInContainer: vi.fn(() => mockChildProcess()),
  getGitRoot: vi.fn(() => '/mock/git/root'),
  listGitWorktrees: vi.fn(() => []),
  validateServiceInComposeFile: vi.fn(() => true),
}));

// Mock process.stdout.write to avoid terminal output during tests
const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

// Prevent process.exit from killing test runner
const processExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

describe('stripAnsi', () => {
  let stripAnsi: (str: string) => string;

  beforeEach(async () => {
    const mod = await import('../src/index');
    stripAnsi = mod.stripAnsi;
  });

  it('strips ANSI color codes', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m')).toBe('hello');
  });

  it('strips multiple ANSI sequences', () => {
    expect(stripAnsi('\x1b[1m\x1b[32mbold green\x1b[0m')).toBe('bold green');
  });

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('strips OSC sequences terminated with ST', () => {
    expect(stripAnsi('\x1b]0;title\x1b\\text')).toBe('text');
  });

  it('strips DCS sequences', () => {
    expect(stripAnsi('\x1bPsome device control\x1b\\visible')).toBe('visible');
  });

  it('strips APC sequences', () => {
    expect(stripAnsi('\x1b_application command\x1b\\visible')).toBe('visible');
  });

  it('strips PM sequences', () => {
    expect(stripAnsi('\x1b^privacy message\x1b\\visible')).toBe('visible');
  });

  it('strips SOS sequences', () => {
    expect(stripAnsi('\x1bXstart of string\x1b\\visible')).toBe('visible');
  });

  it('strips mixed DCS/CSI/OSC sequences', () => {
    expect(stripAnsi('\x1bPdcs\x1b\\\x1b[31mred\x1b[0m\x1b]0;title\x07end')).toBe('redend');
  });
});

describe('shellEscape', () => {
  let shellEscape: (str: string) => string;

  beforeEach(async () => {
    const mod = await import('../src/index');
    shellEscape = mod.shellEscape;
  });

  it('wraps simple string in single quotes', () => {
    expect(shellEscape('foo')).toBe("'foo'");
  });

  it('escapes single quotes within the string', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('neutralises shell metacharacters', () => {
    expect(shellEscape('$(whoami)')).toBe("'$(whoami)'");
    expect(shellEscape('; rm -rf /')).toBe("'; rm -rf /'");
    expect(shellEscape('`id`')).toBe("'`id`'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });
});

describe('loadConfig validation', () => {
  let loadConfig: () => import('../src/lib/types').Config;
  const origCwd = process.cwd;
  const origArgv = process.argv;

  beforeEach(async () => {
    const mod = await import('../src/index');
    loadConfig = mod.loadConfig;
  });

  afterEach(() => {
    process.cwd = origCwd;
    process.argv = origArgv;
  });

  it('ignores non-numeric values for numeric fields', async () => {
    const fs = await import('fs');
    const existsSyncSpy = vi.spyOn(fs.default, 'existsSync').mockReturnValue(true);
    const readFileSyncSpy = vi.spyOn(fs.default, 'readFileSync').mockReturnValue(JSON.stringify({
      composeFiles: ['test.yml'],
      pollInterval: 'not-a-number',
      logTailLines: null,
      statsInterval: { nested: true },
    }));

    const config = loadConfig();
    expect(config.pollInterval).toBe(3000); // default preserved
    expect(config.logTailLines).toBe(100);  // default preserved
    expect(config.statsInterval).toBe(5000); // default preserved

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it('rejects out-of-range numeric values', async () => {
    const fs = await import('fs');
    const existsSyncSpy = vi.spyOn(fs.default, 'existsSync').mockReturnValue(true);
    const readFileSyncSpy = vi.spyOn(fs.default, 'readFileSync').mockReturnValue(JSON.stringify({
      composeFiles: ['test.yml'],
      pollInterval: 0,
      statsBufferSize: -5,
      bottomLogCount: 999999,
    }));

    const config = loadConfig();
    expect(config.pollInterval).toBe(3000);
    expect(config.statsBufferSize).toBe(6);
    expect(config.bottomLogCount).toBe(10);

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it('rejects __proto__ and non-object config', async () => {
    const fs = await import('fs');
    const existsSyncSpy = vi.spyOn(fs.default, 'existsSync').mockReturnValue(true);
    const readFileSyncSpy = vi.spyOn(fs.default, 'readFileSync').mockReturnValue(JSON.stringify({
      composeFiles: ['test.yml'],
      __proto__: { polluted: true },
    }));

    const config = loadConfig();
    expect((config as unknown as Record<string, unknown>).polluted).toBeUndefined();

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it('rejects non-string-array composeFiles', async () => {
    const fs = await import('fs');
    const existsSyncSpy = vi.spyOn(fs.default, 'existsSync').mockReturnValue(true);
    const readFileSyncSpy = vi.spyOn(fs.default, 'readFileSync').mockReturnValue(JSON.stringify({
      composeFiles: [123, null],
    }));

    // should keep default empty array and exit
    expect(() => loadConfig()).not.toThrow();

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it('accepts valid numeric values', async () => {
    const fs = await import('fs');
    const existsSyncSpy = vi.spyOn(fs.default, 'existsSync').mockReturnValue(true);
    const readFileSyncSpy = vi.spyOn(fs.default, 'readFileSync').mockReturnValue(JSON.stringify({
      composeFiles: ['test.yml'],
      pollInterval: 5000,
      logTailLines: 200,
      bottomLogCount: 20,
    }));

    const config = loadConfig();
    expect(config.pollInterval).toBe(5000);
    expect(config.logTailLines).toBe(200);
    expect(config.bottomLogCount).toBe(20);

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });
});

describe('exec history cap', () => {
  let runExecCommand: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    runExecCommand = mod.runExecCommand;
  });

  it('caps exec history at 1000 entries', () => {
    const state = createTestState();
    state.execContainerId = 'abc123';
    state.execService = 'web';
    state.execActive = true;
    state.mode = MODE.LIST;
    // Pre-fill with 1000 unique entries
    for (let i = 0; i < 1000; i++) {
      state.execHistory.push(`cmd-${i}`);
    }
    expect(state.execHistory.length).toBe(1000);

    state.execInput = 'new-command';
    runExecCommand(state);

    expect(state.execHistory.length).toBe(1000);
    expect(state.execHistory[0]).toBe('cmd-1'); // first was shifted off
    expect(state.execHistory[999]).toBe('new-command');
  });
});

describe('handleKeypress - LIST mode', () => {
  let handleKeypress: (state: AppState, key: string) => void;
  let render: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
    render = mod.render;
  });

  it('j moves cursor down', () => {
    const state = createTestState();
    state.cursor = 0;
    handleKeypress(state, 'j');
    expect(state.cursor).toBe(1);
  });

  it('k moves cursor up', () => {
    const state = createTestState();
    state.cursor = 2;
    handleKeypress(state, 'k');
    expect(state.cursor).toBe(1);
  });

  it('n toggles noCache', () => {
    const state = createTestState();
    expect(state.noCache).toBe(false);
    handleKeypress(state, 'n');
    expect(state.noCache).toBe(true);
    handleKeypress(state, 'n');
    expect(state.noCache).toBe(false);
  });

  it('l toggles bottom panel', () => {
    const state = createTestState();
    expect(state.showBottomLogs).toBe(true);
    handleKeypress(state, 'l');
    expect(state.showBottomLogs).toBe(false);
    handleKeypress(state, 'l');
    expect(state.showBottomLogs).toBe(true);
  });

  it('G moves cursor to bottom', () => {
    const state = createTestState();
    state.cursor = 0;
    handleKeypress(state, 'G');
    expect(state.cursor).toBe(state.flatList.length - 1);
  });

  it('/ starts bottom search when panel is active', () => {
    const state = createTestState();
    state.showBottomLogs = true;
    handleKeypress(state, '/');
    expect(state.bottomSearchActive).toBe(true);
    expect(state.bottomSearchQuery).toBe('');
  });

  it('/ does nothing when bottom panel is hidden', () => {
    const state = createTestState();
    state.showBottomLogs = false;
    handleKeypress(state, '/');
    expect(state.bottomSearchActive).toBe(false);
  });

  it('f enters logs mode', () => {
    const state = createTestState();
    handleKeypress(state, 'f');
    expect(state.mode).toBe(MODE.LOGS);
  });

  it('Enter enters logs mode', () => {
    const state = createTestState();
    handleKeypress(state, '\r');
    expect(state.mode).toBe(MODE.LOGS);
  });

  it('arrow down moves cursor', () => {
    const state = createTestState();
    state.cursor = 0;
    handleKeypress(state, '\x1b[B');
    expect(state.cursor).toBe(1);
  });

  it('arrow up moves cursor', () => {
    const state = createTestState();
    state.cursor = 2;
    handleKeypress(state, '\x1b[A');
    expect(state.cursor).toBe(1);
  });
});

describe('handleKeypress - LIST bottom search', () => {
  let handleKeypress: (state: AppState, key: string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
  });

  it('accumulates characters in search query', () => {
    const state = createTestState();
    state.bottomSearchActive = true;
    state.bottomSearchQuery = '';
    handleKeypress(state, 'e');
    handleKeypress(state, 'r');
    handleKeypress(state, 'r');
    expect(state.bottomSearchQuery).toBe('err');
  });

  it('backspace removes last character', () => {
    const state = createTestState();
    state.bottomSearchActive = true;
    state.bottomSearchQuery = 'error';
    handleKeypress(state, '\x7f');
    expect(state.bottomSearchQuery).toBe('erro');
  });

  it('Esc cancels search', () => {
    const state = createTestState();
    state.bottomSearchActive = true;
    state.bottomSearchQuery = 'test';
    handleKeypress(state, '\x1b');
    expect(state.bottomSearchActive).toBe(false);
    expect(state.bottomSearchQuery).toBe('');
  });

  it('Enter confirms search', () => {
    const state = createTestState();
    state.bottomSearchActive = true;
    state.bottomSearchQuery = 'test';
    handleKeypress(state, '\r');
    expect(state.bottomSearchActive).toBe(false);
    expect(state.bottomSearchQuery).toBe('test');
  });

  it('Enter with query triggers full log fetch', () => {
    const state = createTestState();
    state.bottomSearchActive = true;
    state.bottomSearchQuery = 'error';
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, { action: 'logs', service: 'postgres', lines: ['original line'] });
    handleKeypress(state, '\r');
    expect(state.bottomSearchActive).toBe(false);
    expect(state.bottomSearchLoading).toBe(true);
    expect(state.bottomSearchSavedLines.has(sk)).toBe(true);
    expect(state.bottomSearchSavedLines.get(sk)).toEqual(['original line']);
  });

  it('Esc clears search and restores saved lines', () => {
    const state = createTestState();
    state.bottomSearchActive = true;
    state.bottomSearchQuery = 'error';
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, { action: 'logs', service: 'postgres', lines: ['filtered line'] });
    state.bottomSearchSavedLines.set(sk, ['original line 1', 'original line 2']);
    handleKeypress(state, '\x1b');
    expect(state.bottomSearchQuery).toBe('');
    const info = state.bottomLogLines.get(sk)!;
    expect(info.lines).toEqual(['original line 1', 'original line 2']);
    expect(state.bottomSearchSavedLines.has(sk)).toBe(false);
  });
});

describe('clearBottomSearch', () => {
  let clearBottomSearch: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    clearBottomSearch = mod.clearBottomSearch;
  });

  it('restores saved lines and resets state', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, { action: 'logs', service: 'postgres', lines: ['matched'] });
    state.bottomSearchSavedLines.set(sk, ['original 1', 'original 2']);
    state.bottomSearchLoading = true;
    state.bottomSearchTotalMatches = 5;
    clearBottomSearch(state);
    expect(state.bottomSearchLoading).toBe(false);
    expect(state.bottomSearchTotalMatches).toBe(0);
    expect(state.bottomLogLines.get(sk)!.lines).toEqual(['original 1', 'original 2']);
    expect(state.bottomSearchSavedLines.has(sk)).toBe(false);
  });

  it('kills pending search child', () => {
    const state = createTestState();
    const mockChild = { kill: vi.fn() } as any;
    state.bottomSearchChild = mockChild;
    clearBottomSearch(state);
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.bottomSearchChild).toBeNull();
  });
});

describe('enterLogs carries bottom search query', () => {
  let enterLogs: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    enterLogs = mod.enterLogs;
  });

  it('carries bottom search query to full log search', () => {
    const state = createTestState();
    state.bottomSearchQuery = 'myerror';
    state.bottomSearchTotalMatches = 5;
    enterLogs(state);
    expect(state.mode).toBe(MODE.LOGS);
    expect(state.logSearchQuery).toBe('myerror');
    expect(state.logSearchPending).toBe(true);
    expect(state.bottomSearchQuery).toBe('myerror');
  });

  it('enters logs without search when no bottom query', () => {
    const state = createTestState();
    state.bottomSearchQuery = '';
    enterLogs(state);
    expect(state.mode).toBe(MODE.LOGS);
    expect(state.logSearchQuery).toBe('');
    expect(state.logSearchPending).toBe(false);
  });
});

describe('enterLogs - build log detection', () => {
  let enterLogs: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    enterLogs = mod.enterLogs;
  });

  it('populates logLines from build output when service is rebuilding', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.rebuilding.set(sk, createMockKillable());
    state.bottomLogLines.set(sk, {
      action: 'rebuilding',
      service: 'postgres',
      lines: ['Step 1/5 FROM node:18', 'Step 2/5 COPY . .', 'Step 3/5 RUN npm install'],
    });
    enterLogs(state);
    expect(state.mode).toBe(MODE.LOGS);
    expect(state.logBuildKey).toBe(sk);
    expect(state.logLines).toEqual(['Step 1/5 FROM node:18', 'Step 2/5 COPY . .', 'Step 3/5 RUN npm install']);
    expect(state.logChild).toBeNull();
    expect(state.logHistoryLoaded).toBe(true);
  });

  it('populates logLines from build output when service has build_failed', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.bottomLogLines.set(sk, {
      action: 'build_failed',
      service: 'postgres',
      lines: ['Step 1/3 FROM node:18', 'Step 2/3 RUN make', 'ERROR: build failed'],
    });
    enterLogs(state);
    expect(state.mode).toBe(MODE.LOGS);
    expect(state.logBuildKey).toBe(sk);
    expect(state.logLines).toEqual(['Step 1/3 FROM node:18', 'Step 2/3 RUN make', 'ERROR: build failed']);
    expect(state.logChild).toBeNull();
  });

  it('populates logLines from build output when service is cascading', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.cascading.set(sk, { steps: [], currentStepIdx: 0, child: null });
    state.bottomLogLines.set(sk, {
      action: 'cascading',
      service: 'postgres',
      lines: ['cascade build line 1'],
    });
    enterLogs(state);
    expect(state.mode).toBe(MODE.LOGS);
    expect(state.logBuildKey).toBe(sk);
    expect(state.logLines).toEqual(['cascade build line 1']);
  });

  it('spawns tailLogs when service is not building', () => {
    const state = createTestState();
    enterLogs(state);
    expect(state.mode).toBe(MODE.LOGS);
    expect(state.logBuildKey).toBeNull();
    expect(state.logChild).not.toBeNull();
  });
});

describe('exitLogs clears logBuildKey', () => {
  let exitLogs: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    exitLogs = mod.exitLogs;
  });

  it('clears logBuildKey on exit', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logBuildKey = 'some-key';
    exitLogs(state);
    expect(state.logBuildKey).toBeNull();
    expect(state.mode).toBe(MODE.LIST);
  });
});

describe('handleKeypress - LOGS mode', () => {
  let handleKeypress: (state: AppState, key: string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
  });

  it('j scrolls down (decreases offset)', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logScrollOffset = 5;
    state.logLines = Array(20).fill('line');
    handleKeypress(state, 'j');
    expect(state.logScrollOffset).toBe(4);
  });

  it('k scrolls up (increases offset)', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logScrollOffset = 3;
    state.logLines = Array(20).fill('line');
    handleKeypress(state, 'k');
    expect(state.logAutoScroll).toBe(false);
    expect(state.logScrollOffset).toBe(4);
  });

  it('G goes to bottom (live mode)', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logScrollOffset = 10;
    state.logAutoScroll = false;
    handleKeypress(state, 'G');
    expect(state.logScrollOffset).toBe(0);
    expect(state.logAutoScroll).toBe(true);
  });

  it('Ctrl+U pages up', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logScrollOffset = 5;
    state.logLines = Array(100).fill('line');
    process.stdout.rows = 20;
    handleKeypress(state, '\x15');
    expect(state.logAutoScroll).toBe(false);
    expect(state.logScrollOffset).toBeGreaterThan(5);
  });

  it('Ctrl+D pages down', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logScrollOffset = 20;
    state.logLines = Array(100).fill('line');
    process.stdout.rows = 20;
    handleKeypress(state, '\x04');
    expect(state.logScrollOffset).toBeLessThan(20);
  });

  it('/ starts search', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    handleKeypress(state, '/');
    expect(state.logSearchActive).toBe(true);
    expect(state.logSearchQuery).toBe('');
  });

  it('f exits logs mode', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    handleKeypress(state, 'f');
    expect(state.mode).toBe(MODE.LIST);
  });

  it('Esc exits logs mode when no search active', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    handleKeypress(state, '\x1b');
    expect(state.mode).toBe(MODE.LIST);
  });

  it('Esc clears search first, then exits on second press', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchQuery = 'error';
    state.logSearchMatches = [0, 2];
    state.logSearchMatchIdx = 1;
    handleKeypress(state, '\x1b');
    // First Esc clears search but stays in LOGS
    expect(state.mode).toBe(MODE.LOGS);
    expect(state.logSearchQuery).toBe('');
    expect(state.logSearchMatches).toEqual([]);
    expect(state.logSearchMatchIdx).toBe(-1);
    // Second Esc exits logs
    handleKeypress(state, '\x1b');
    expect(state.mode).toBe(MODE.LIST);
  });

  it('f always exits logs even with active search', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchQuery = 'error';
    state.logSearchMatches = [0, 2];
    handleKeypress(state, 'f');
    expect(state.mode).toBe(MODE.LIST);
  });
});

describe('handleKeypress - LOGS search input', () => {
  let handleKeypress: (state: AppState, key: string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
  });

  it('accumulates characters', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchActive = true;
    state.logSearchQuery = '';
    handleKeypress(state, 'e');
    handleKeypress(state, 'r');
    expect(state.logSearchQuery).toBe('er');
  });

  it('backspace removes last character', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchActive = true;
    state.logSearchQuery = 'test';
    handleKeypress(state, '\x7f');
    expect(state.logSearchQuery).toBe('tes');
  });

  it('Esc cancels search', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchActive = true;
    state.logSearchQuery = 'test';
    handleKeypress(state, '\x1b');
    expect(state.logSearchActive).toBe(false);
    expect(state.logSearchQuery).toBe('');
  });

  it('Enter executes search immediately when history loaded', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchActive = true;
    state.logSearchQuery = 'error';
    state.logLines = ['no match', 'an error occurred', 'another error'];
    state.logHistoryLoaded = true;
    handleKeypress(state, '\r');
    expect(state.logSearchActive).toBe(false);
    expect(state.logSearchMatches).toEqual([1, 2]);
  });

  it('Enter triggers history load when not fully loaded', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchActive = true;
    state.logSearchQuery = 'error';
    state.logLines = ['no match', 'an error occurred'];
    handleKeypress(state, '\r');
    expect(state.logSearchActive).toBe(false);
    expect(state.logSearchPending).toBe(true);
    expect(state.logHistoryLoading).toBe(true);
  });
});

describe('executeLogSearch', () => {
  let executeLogSearch: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    executeLogSearch = mod.executeLogSearch;
  });

  it('finds matching lines case-insensitively', () => {
    const state = createTestState();
    state.logLines = ['ERROR here', 'all good', 'another Error', 'fine'];
    state.logSearchQuery = 'error';
    executeLogSearch(state);
    expect(state.logSearchMatches).toEqual([0, 2]);
    expect(state.logSearchMatchIdx).toBe(0);
  });

  it('resets matches for empty query', () => {
    const state = createTestState();
    state.logSearchQuery = '';
    executeLogSearch(state);
    expect(state.logSearchMatches).toEqual([]);
    expect(state.logSearchMatchIdx).toBe(-1);
  });

  it('handles no matches', () => {
    const state = createTestState();
    state.logLines = ['line 1', 'line 2'];
    state.logSearchQuery = 'notfound';
    executeLogSearch(state);
    expect(state.logSearchMatches).toEqual([]);
    expect(state.logSearchMatchIdx).toBe(-1);
  });
});

describe('jumpToNextMatch / jumpToPrevMatch', () => {
  let jumpToNextMatch: (state: AppState) => void;
  let jumpToPrevMatch: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    jumpToNextMatch = mod.jumpToNextMatch;
    jumpToPrevMatch = mod.jumpToPrevMatch;
  });

  it('n cycles forward through matches', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logLines = Array(50).fill('line');
    state.logSearchMatches = [5, 15, 25];
    state.logSearchMatchIdx = 0;
    jumpToNextMatch(state);
    expect(state.logSearchMatchIdx).toBe(1);
    jumpToNextMatch(state);
    expect(state.logSearchMatchIdx).toBe(2);
    jumpToNextMatch(state);
    expect(state.logSearchMatchIdx).toBe(0); // wraps
  });

  it('N cycles backward through matches', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logLines = Array(50).fill('line');
    state.logSearchMatches = [5, 15, 25];
    state.logSearchMatchIdx = 0;
    jumpToPrevMatch(state);
    expect(state.logSearchMatchIdx).toBe(2); // wraps to end
    jumpToPrevMatch(state);
    expect(state.logSearchMatchIdx).toBe(1);
  });

  it('does nothing with no matches', () => {
    const state = createTestState();
    state.logSearchMatches = [];
    state.logSearchMatchIdx = -1;
    jumpToNextMatch(state);
    expect(state.logSearchMatchIdx).toBe(-1);
    jumpToPrevMatch(state);
    expect(state.logSearchMatchIdx).toBe(-1);
  });
});

describe('createInputHandler', () => {
  let createInputHandler: (state: AppState) => (data: Buffer | string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    createInputHandler = mod.createInputHandler;
  });

  it('handles regular key presses', () => {
    const state = createTestState();
    const handler = createInputHandler(state);
    handler('n');
    expect(state.noCache).toBe(true);
  });

  it('handles arrow down escape sequence', () => {
    const state = createTestState();
    state.cursor = 0;
    const handler = createInputHandler(state);
    handler('\x1b[B');
    expect(state.cursor).toBe(1);
  });

  it('handles arrow up escape sequence', () => {
    const state = createTestState();
    state.cursor = 2;
    const handler = createInputHandler(state);
    handler('\x1b[A');
    expect(state.cursor).toBe(1);
  });

  it('passes search characters directly in search mode', () => {
    const state = createTestState();
    state.bottomSearchActive = true;
    state.bottomSearchQuery = '';
    const handler = createInputHandler(state);
    handler('a');
    handler('b');
    expect(state.bottomSearchQuery).toBe('ab');
  });
});

describe('cleanup', () => {
  let cleanup: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    cleanup = mod.cleanup;
  });

  it('kills log child process', () => {
    const state = createTestState();
    const mockChild = { kill: vi.fn() } as any;
    state.logChild = mockChild;
    cleanup(state);
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.logChild).toBeNull();
  });

  it('kills all rebuilding processes', () => {
    const state = createTestState();
    const kill1 = vi.fn();
    const kill2 = vi.fn();
    state.rebuilding.set('a', { kill: kill1 });
    state.rebuilding.set('b', { kill: kill2 });
    cleanup(state);
    expect(kill1).toHaveBeenCalledWith('SIGTERM');
    expect(kill2).toHaveBeenCalledWith('SIGTERM');
    expect(state.rebuilding.size).toBe(0);
  });

  it('kills all restarting processes', () => {
    const state = createTestState();
    const kill = vi.fn();
    state.restarting.set('a', { kill });
    cleanup(state);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.restarting.size).toBe(0);
  });

  it('kills all stopping processes', () => {
    const state = createTestState();
    const kill = vi.fn();
    state.stopping.set('a', { kill });
    cleanup(state);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.stopping.size).toBe(0);
  });

  it('kills all starting processes', () => {
    const state = createTestState();
    const kill = vi.fn();
    state.starting.set('a', { kill });
    cleanup(state);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.starting.size).toBe(0);
  });

  it('kills all bottom log tail processes', () => {
    const state = createTestState();
    const kill = vi.fn();
    state.bottomLogTails.set('a', { kill });
    cleanup(state);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.bottomLogTails.size).toBe(0);
  });

  it('clears timers', () => {
    const state = createTestState();
    state.pollTimer = setInterval(() => {}, 999999);
    state.logScanTimer = setInterval(() => {}, 999999);
    state.statsTimer = setInterval(() => {}, 999999);
    cleanup(state);
    // Timers are cleared; no easy way to verify but no errors means it worked
  });

  it('writes reset sequences to stdout', () => {
    const state = createTestState();
    cleanup(state);
    expect(stdoutWrite).toHaveBeenCalled();
  });
});

describe('throttledRender', () => {
  let throttledRender: (state: AppState) => void;
  let _getModuleState: () => any;
  let _setModuleState: (ms: any) => void;
  let createModuleState: () => any;

  beforeEach(async () => {
    const mod = await import('../src/index');
    throttledRender = mod.throttledRender;
    _getModuleState = mod._getModuleState;
    _setModuleState = mod._setModuleState;
    createModuleState = mod.createModuleState;
    _setModuleState(createModuleState());
  });

  it('renders immediately when enough time has passed', () => {
    const state = createTestState();
    const ms = _getModuleState();
    ms.lastRenderTime = 0;
    throttledRender(state);
    expect(ms.lastRenderTime).toBeGreaterThan(0);
  });

  it('defers render when called too soon', () => {
    const state = createTestState();
    const ms = _getModuleState();
    ms.lastRenderTime = Date.now();
    throttledRender(state);
    expect(ms.pendingRender).not.toBeNull();
    // Clean up
    if (ms.pendingRender) clearTimeout(ms.pendingRender);
    ms.pendingRender = null;
  });
});

describe('discoverServices', () => {
  let discoverServices: (config: Config) => any[];

  beforeEach(async () => {
    const mod = await import('../src/index');
    discoverServices = mod.discoverServices;
  });

  it('calls listServices for each compose file', async () => {
    const { listServices } = await import('../src/lib/docker');
    (listServices as any).mockReturnValue(['web', 'api']);

    const config = createTestConfig({ composeFiles: ['/a.yml'] });
    const groups = discoverServices(config);
    expect(groups).toHaveLength(1);
    expect(groups[0].services).toEqual(['web', 'api']);
    expect(groups[0].error).toBeNull();
  });

  it('captures errors in group.error', async () => {
    const { listServices } = await import('../src/lib/docker');
    (listServices as any).mockImplementation(() => { throw new Error('docker not found'); });

    const config = createTestConfig({ composeFiles: ['/a.yml'] });
    const groups = discoverServices(config);
    expect(groups[0].error).toBe('docker not found');
    expect(groups[0].services).toEqual([]);
  });
});

describe('handleKeypress - watch keybinding', () => {
  let handleKeypress: (state: AppState, key: string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
  });

  it('w activates watch on running service', () => {
    const state = createTestState();
    // w should call doWatch which interacts with docker
    handleKeypress(state, 'w');
    // Watch was initiated (watching map should have an entry)
    expect(state.watching.size).toBe(1);
  });

  it('w toggles watch off when already watching', () => {
    const state = createTestState();
    state.watching.set(statusKey(state.flatList[0].file, state.flatList[0].service), { kill: vi.fn() });
    handleKeypress(state, 'w');
    expect(state.watching.size).toBe(0);
  });
});

describe('handleKeypress - exec keybinding', () => {
  let handleKeypress: (state: AppState, key: string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
  });

  it('e enters inline exec on running container', () => {
    const state = createTestState();
    handleKeypress(state, 'e');
    expect(state.mode).toBe(MODE.LIST);
    expect(state.execActive).toBe(true);
    expect(state.execService).toBe('postgres');
  });

  it('x enters full-screen exec on running container', () => {
    const state = createTestState();
    handleKeypress(state, 'x');
    expect(state.mode).toBe(MODE.EXEC);
    expect(state.execService).toBe('postgres');
  });

  it('e does nothing on stopped container', () => {
    const state = createTestState();
    const sk = statusKey(state.flatList[0].file, state.flatList[0].service);
    state.statuses.set(sk, { state: 'exited', health: '', createdAt: null, startedAt: null, id: null, ports: [], workingDir: null, worktree: null });
    handleKeypress(state, 'e');
    expect(state.mode).toBe(MODE.LIST);
    expect(state.execActive).toBe(false);
  });

  it('x from inline exec expands to full screen', () => {
    const state = createTestState();
    state.execActive = true;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    state.execOutputLines = ['$ ls', 'file1', 'file2'];
    handleKeypress(state, 'x');
    expect(state.mode).toBe(MODE.EXEC);
    expect(state.execActive).toBe(false);
    // Preserves existing output
    expect(state.execOutputLines).toEqual(['$ ls', 'file1', 'file2']);
  });

  it('Esc exits full-screen exec mode', () => {
    const state = createTestState();
    state.mode = MODE.EXEC;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    handleKeypress(state, '\x1b');
    expect(state.mode).toBe(MODE.LIST);
    expect(state.execService).toBeNull();
  });

  it('Esc exits inline exec mode', () => {
    const state = createTestState();
    state.execActive = true;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    handleKeypress(state, '\x1b');
    expect(state.mode).toBe(MODE.LIST);
    expect(state.execActive).toBe(false);
    expect(state.execService).toBeNull();
  });

  it('typing accumulates in full-screen execInput', () => {
    const state = createTestState();
    state.mode = MODE.EXEC;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    handleKeypress(state, 'l');
    handleKeypress(state, 's');
    expect(state.execInput).toBe('ls');
  });

  it('typing accumulates in inline execInput', () => {
    const state = createTestState();
    state.execActive = true;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    handleKeypress(state, 'l');
    handleKeypress(state, 's');
    expect(state.execInput).toBe('ls');
  });

  it('backspace removes last char in exec input', () => {
    const state = createTestState();
    state.mode = MODE.EXEC;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    state.execInput = 'ls -la';
    handleKeypress(state, '\x7f');
    expect(state.execInput).toBe('ls -l');
  });

  it('up arrow navigates exec history', () => {
    const state = createTestState();
    state.mode = MODE.EXEC;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    state.execHistory = ['ls', 'pwd', 'whoami'];
    state.execHistoryIdx = -1;
    handleKeypress(state, '\x1b[A');
    expect(state.execHistoryIdx).toBe(2);
    expect(state.execInput).toBe('whoami');
    handleKeypress(state, '\x1b[A');
    expect(state.execHistoryIdx).toBe(1);
    expect(state.execInput).toBe('pwd');
  });

  it('up arrow navigates inline exec history', () => {
    const state = createTestState();
    state.execActive = true;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    state.execHistory = ['ls', 'pwd'];
    state.execHistoryIdx = -1;
    handleKeypress(state, '\x1b[A');
    expect(state.execHistoryIdx).toBe(1);
    expect(state.execInput).toBe('pwd');
  });

  it('down arrow navigates exec history forward', () => {
    const state = createTestState();
    state.mode = MODE.EXEC;
    state.execService = 'postgres';
    state.execContainerId = 'abc123';
    state.execHistory = ['ls', 'pwd'];
    state.execHistoryIdx = 0;
    handleKeypress(state, '\x1b[B');
    expect(state.execHistoryIdx).toBe(1);
    expect(state.execInput).toBe('pwd');
    handleKeypress(state, '\x1b[B');
    expect(state.execHistoryIdx).toBe(-1);
    expect(state.execInput).toBe('');
  });
});

describe('handleKeypress - dep rebuild keybinding', () => {
  let handleKeypress: (state: AppState, key: string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
  });

  it('d falls back to regular rebuild when no dependents', () => {
    const state = createTestState();
    // depGraphs is empty, so doCascadeRebuild falls back to doRebuild
    handleKeypress(state, 'd');
    expect(state.rebuilding.size).toBe(1);
  });
});

describe('cleanup - new features', () => {
  let cleanup: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    cleanup = mod.cleanup;
  });

  it('kills all watch processes', () => {
    const state = createTestState();
    const kill = vi.fn();
    state.watching.set('a', { kill });
    cleanup(state);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.watching.size).toBe(0);
  });

  it('kills cascade child processes', () => {
    const state = createTestState();
    const kill = vi.fn();
    state.cascading.set('a', {
      steps: [],
      currentStepIdx: 0,
      child: { kill } as any,
    });
    cleanup(state);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.cascading.size).toBe(0);
  });

  it('kills exec child process', () => {
    const state = createTestState();
    const kill = vi.fn();
    state.execChild = { kill } as any;
    cleanup(state);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(state.execChild).toBeNull();
  });
});

describe('detectMultipleWorktrees', () => {
  let detectMultipleWorktrees: (state: AppState) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    detectMultipleWorktrees = mod.detectMultipleWorktrees;
  });

  it('sets showWorktreeColumn true when 2+ distinct worktrees', () => {
    const state = createTestState();
    const sk1 = statusKey(state.groups[0].file, 'postgres');
    const sk2 = statusKey(state.groups[1].file, 'api-gateway');
    state.statuses.set(sk1, { state: 'running', health: '', createdAt: null, startedAt: null, id: '1', ports: [], workingDir: '/path/a', worktree: 'main' });
    state.statuses.set(sk2, { state: 'running', health: '', createdAt: null, startedAt: null, id: '2', ports: [], workingDir: '/path/b', worktree: 'fix-bug' });
    detectMultipleWorktrees(state);
    expect(state.showWorktreeColumn).toBe(true);
  });

  it('sets showWorktreeColumn false when all same worktree', () => {
    const state = createTestState();
    const sk1 = statusKey(state.groups[0].file, 'postgres');
    const sk2 = statusKey(state.groups[0].file, 'redis');
    state.statuses.set(sk1, { state: 'running', health: '', createdAt: null, startedAt: null, id: '1', ports: [], workingDir: '/path/a', worktree: 'main' });
    state.statuses.set(sk2, { state: 'running', health: '', createdAt: null, startedAt: null, id: '2', ports: [], workingDir: '/path/a', worktree: 'main' });
    detectMultipleWorktrees(state);
    expect(state.showWorktreeColumn).toBe(false);
  });

  it('ignores non-running containers', () => {
    const state = createTestState();
    const sk1 = statusKey(state.groups[0].file, 'postgres');
    const sk2 = statusKey(state.groups[0].file, 'redis');
    state.statuses.set(sk1, { state: 'running', health: '', createdAt: null, startedAt: null, id: '1', ports: [], workingDir: '/path/a', worktree: 'main' });
    state.statuses.set(sk2, { state: 'exited', health: '', createdAt: null, startedAt: null, id: '2', ports: [], workingDir: '/path/b', worktree: 'fix-bug' });
    detectMultipleWorktrees(state);
    expect(state.showWorktreeColumn).toBe(false);
  });
});

describe('handleKeypress - worktree picker', () => {
  let handleKeypress: (state: AppState, key: string) => void;
  let listGitWorktreesMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../src/index');
    handleKeypress = mod.handleKeypress;
    const docker = await import('../src/lib/docker');
    listGitWorktreesMock = docker.listGitWorktrees as ReturnType<typeof vi.fn>;
  });

  it('t opens worktree picker when worktrees exist', () => {
    const state = createTestState();
    listGitWorktreesMock.mockReturnValue([
      { path: '/path/to/main', branch: 'main' },
      { path: '/path/to/fix', branch: 'fix-bug' },
    ]);
    handleKeypress(state, 't');
    expect(state.worktreePickerActive).toBe(true);
    expect(state.worktreePickerEntries).toHaveLength(2);
  });

  it('t shows message when only one worktree', () => {
    const state = createTestState();
    listGitWorktreesMock.mockReturnValue([
      { path: '/path/to/main', branch: 'main' },
    ]);
    handleKeypress(state, 't');
    expect(state.worktreePickerActive).toBe(false);
    const sk = statusKey(state.flatList[state.cursor].file, state.flatList[state.cursor].service);
    const info = state.bottomLogLines.get(sk);
    expect(info).toBeDefined();
    expect(info!.action).toBe('switch_failed');
  });

  it('t does nothing when service is rebuilding', () => {
    const state = createTestState();
    const entry = state.flatList[state.cursor];
    const sk = statusKey(entry.file, entry.service);
    state.rebuilding.set(sk, createMockKillable());
    listGitWorktreesMock.mockReturnValue([
      { path: '/path/to/main', branch: 'main' },
      { path: '/path/to/fix', branch: 'fix-bug' },
    ]);
    handleKeypress(state, 't');
    expect(state.worktreePickerActive).toBe(false);
  });

  it('Esc cancels worktree picker', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/path/to/main', branch: 'main' },
      { path: '/path/to/fix', branch: 'fix-bug' },
    ];
    state.worktreePickerCursor = 1;
    handleKeypress(state, '\x1b');
    expect(state.worktreePickerActive).toBe(false);
    expect(state.worktreePickerEntries).toHaveLength(0);
    expect(state.worktreePickerCursor).toBe(0);
  });

  it('j moves picker cursor down', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
      { path: '/b', branch: 'fix' },
      { path: '/c', branch: 'feature' },
    ];
    state.worktreePickerCursor = 0;
    handleKeypress(state, 'j');
    expect(state.worktreePickerCursor).toBe(1);
  });

  it('k moves picker cursor up', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
      { path: '/b', branch: 'fix' },
    ];
    state.worktreePickerCursor = 1;
    handleKeypress(state, 'k');
    expect(state.worktreePickerCursor).toBe(0);
  });

  it('j clamps at end of list', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
      { path: '/b', branch: 'fix' },
    ];
    state.worktreePickerCursor = 1;
    handleKeypress(state, 'j');
    expect(state.worktreePickerCursor).toBe(1);
  });

  it('k clamps at start of list', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
    ];
    state.worktreePickerCursor = 0;
    handleKeypress(state, 'k');
    expect(state.worktreePickerCursor).toBe(0);
  });

  it('G jumps to last entry', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
      { path: '/b', branch: 'fix' },
      { path: '/c', branch: 'feature' },
    ];
    state.worktreePickerCursor = 0;
    handleKeypress(state, 'G');
    expect(state.worktreePickerCursor).toBe(2);
  });

  it('picker does not pass keys to list mode', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
    ];
    const originalCursor = state.cursor;
    handleKeypress(state, 'b'); // should not trigger rebuild
    expect(state.cursor).toBe(originalCursor);
    expect(state.rebuilding.size).toBe(0);
  });
});

describe('mapComposeFileToWorktree', () => {
  let mapComposeFileToWorktree: (composeFile: string, targetPath: string) => string | null;
  let getGitRootMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../src/index');
    mapComposeFileToWorktree = mod.mapComposeFileToWorktree;
    const docker = await import('../src/lib/docker');
    getGitRootMock = docker.getGitRoot as ReturnType<typeof vi.fn>;
  });

  it('returns null when getGitRoot returns null', () => {
    getGitRootMock.mockReturnValue(null);
    expect(mapComposeFileToWorktree('/some/file.yml', '/target')).toBeNull();
  });

  it('returns null when target file does not exist', () => {
    getGitRootMock.mockReturnValue('/git/root');
    // fs.accessSync will throw for non-existent files
    expect(mapComposeFileToWorktree('/git/root/services/docker-compose.yml', '/target/worktree')).toBeNull();
  });
});

describe('createInputHandler - worktree picker guard', () => {
  let createInputHandler: (state: AppState) => (data: Buffer | string) => void;

  beforeEach(async () => {
    const mod = await import('../src/index');
    createInputHandler = mod.createInputHandler;
  });

  it('does not buffer g key when picker is active', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/a', branch: 'main' },
      { path: '/b', branch: 'fix' },
    ];
    const handler = createInputHandler(state);
    const originalCursor = state.cursor;
    // 'g' should be passed through to handleKeypress, not buffered for gg
    handler('g');
    // Since picker handles limited keys, g is ignored — cursor should not move
    expect(state.cursor).toBe(originalCursor);
  });
});

describe('doWorktreeSwitch - groups not modified', () => {
  let doWorktreeSwitch: (state: AppState, target: import('../src/lib/types').GitWorktree) => void;
  let validateMock: ReturnType<typeof vi.fn>;
  let getGitRootMock: ReturnType<typeof vi.fn>;
  let mapMock: (composeFile: string, targetPath: string) => string | null;

  beforeEach(async () => {
    const mod = await import('../src/index');
    doWorktreeSwitch = mod.doWorktreeSwitch;
    const docker = await import('../src/lib/docker');
    validateMock = docker.validateServiceInComposeFile as ReturnType<typeof vi.fn>;
    getGitRootMock = docker.getGitRoot as ReturnType<typeof vi.fn>;
  });

  it('does not modify groups when switching worktree', () => {
    const state = createTestState();
    const originalGroups = JSON.stringify(state.groups.map(g => ({ file: g.file, label: g.label, services: [...g.services] })));
    getGitRootMock.mockReturnValue('/mock/git/root');
    validateMock.mockReturnValue(true);

    // doWorktreeSwitch will fail at mapComposeFileToWorktree (file not found)
    // but that's ok — we just verify groups aren't touched
    doWorktreeSwitch(state, { path: '/nonexistent', branch: 'fix-bug' });
    const afterGroups = JSON.stringify(state.groups.map(g => ({ file: g.file, label: g.label, services: [...g.services] })));
    expect(afterGroups).toBe(originalGroups);
  });

  it('sets worktreeOverrides on switch_failed (file not found)', () => {
    const state = createTestState();
    getGitRootMock.mockReturnValue('/mock/git/root');
    doWorktreeSwitch(state, { path: '/nonexistent', branch: 'fix-bug' });
    // Override should NOT be set on failure
    expect(state.worktreeOverrides.size).toBe(0);
  });

  it('preserves flatList structure after switch attempt', () => {
    const state = createTestState();
    const originalLen = state.flatList.length;
    getGitRootMock.mockReturnValue('/mock/git/root');
    doWorktreeSwitch(state, { path: '/nonexistent', branch: 'fix-bug' });
    expect(state.flatList.length).toBe(originalLen);
  });
});

describe('pollStatuses with worktree overrides', () => {
  let pollStatuses: (state: AppState) => void;
  let getStatusesMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import('../src/index');
    pollStatuses = mod.pollStatuses;
    const docker = await import('../src/lib/docker');
    getStatusesMock = docker.getStatuses as ReturnType<typeof vi.fn>;
  });

  it('polls override file for services with worktree overrides', () => {
    const state = createTestState();
    const entry = state.flatList[0];
    const sk = statusKey(entry.file, entry.service);
    const overrideFile = '/override/docker-compose.yml';
    state.worktreeOverrides.set(sk, overrideFile);

    getStatusesMock.mockReturnValue(new Map());
    pollStatuses(state);

    // Should have been called with both the original file and the override file
    const calledFiles = getStatusesMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(calledFiles).toContain(overrideFile);
  });
});
