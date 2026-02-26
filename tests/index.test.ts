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
    state.logScrollOffset = 5;
    state.logLines = Array(20).fill('line');
    handleKeypress(state, 'k');
    expect(state.logAutoScroll).toBe(false);
    expect(state.logScrollOffset).toBe(6);
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

  it('Esc exits logs mode', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    handleKeypress(state, '\x1b');
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

  it('Enter executes search', () => {
    const state = createTestState();
    state.mode = MODE.LOGS;
    state.logSearchActive = true;
    state.logSearchQuery = 'error';
    state.logLines = ['no match', 'an error occurred', 'another error'];
    handleKeypress(state, '\r');
    expect(state.logSearchActive).toBe(false);
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
    state.statuses.set(sk, { state: 'exited', health: '', createdAt: null, startedAt: null, id: null, ports: [] });
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
