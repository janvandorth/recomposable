import { describe, it, expect } from 'vitest';
import { createState, statusKey, buildFlatList, moveCursor, selectedEntry, MODE, worktreeLabel, getEffectiveFile } from '../src/lib/state';
import { createTestConfig, createMockGroups } from './helpers';

describe('MODE', () => {
  it('has LIST and LOGS constants', () => {
    expect(MODE.LIST).toBe('LIST');
    expect(MODE.LOGS).toBe('LOGS');
  });
});

describe('createState', () => {
  it('returns correct shape with all Maps initialized', () => {
    const config = createTestConfig();
    const state = createState(config);

    expect(state.mode).toBe(MODE.LIST);
    expect(state.groups).toEqual([]);
    expect(state.flatList).toEqual([]);
    expect(state.cursor).toBe(0);
    expect(state.statuses).toBeInstanceOf(Map);
    expect(state.statuses.size).toBe(0);
    expect(state.rebuilding).toBeInstanceOf(Map);
    expect(state.restarting).toBeInstanceOf(Map);
    expect(state.stopping).toBeInstanceOf(Map);
    expect(state.starting).toBeInstanceOf(Map);
    expect(state.containerStats).toBeInstanceOf(Map);
    expect(state.containerStatsHistory).toBeInstanceOf(Map);
    expect(state.logChild).toBeNull();
    expect(state.scrollOffset).toBe(0);
    expect(state.noCache).toBe(false);
    expect(state.showBottomLogs).toBe(true);
    expect(state.bottomLogLines).toBeInstanceOf(Map);
    expect(state.bottomLogTails).toBeInstanceOf(Map);
    expect(state.selectedLogKey).toBeNull();
    expect(state.logCounts).toBeInstanceOf(Map);
    expect(state.logLines).toEqual([]);
    expect(state.logScrollOffset).toBe(0);
    expect(state.logAutoScroll).toBe(true);
    expect(state.logSearchQuery).toBe('');
    expect(state.logSearchActive).toBe(false);
    expect(state.logSearchMatches).toEqual([]);
    expect(state.logSearchMatchIdx).toBe(-1);
    expect(state.bottomSearchQuery).toBe('');
    expect(state.bottomSearchActive).toBe(false);
    expect(state.config).toBe(config);
  });
});

describe('statusKey', () => {
  it('concatenates file and service with ::', () => {
    expect(statusKey('/path/to/compose.yml', 'web')).toBe('/path/to/compose.yml::web');
  });

  it('works with empty strings', () => {
    expect(statusKey('', '')).toBe('::');
  });

  it('preserves special characters', () => {
    expect(statusKey('/my file/compose.yml', 'my-service_1')).toBe('/my file/compose.yml::my-service_1');
  });
});

describe('buildFlatList', () => {
  it('builds flat list from single group', () => {
    const groups = [{
      file: '/a.yml',
      label: 'a',
      services: ['svc1', 'svc2'],
      error: null,
    }];
    const list = buildFlatList(groups);
    expect(list).toEqual([
      { groupIdx: 0, serviceIdx: 0, service: 'svc1', file: '/a.yml' },
      { groupIdx: 0, serviceIdx: 1, service: 'svc2', file: '/a.yml' },
    ]);
  });

  it('builds flat list from multiple groups', () => {
    const groups = createMockGroups();
    const list = buildFlatList(groups);
    expect(list).toHaveLength(5); // 2 + 3
    expect(list[0].groupIdx).toBe(0);
    expect(list[0].service).toBe('postgres');
    expect(list[2].groupIdx).toBe(1);
    expect(list[2].service).toBe('api-gateway');
    expect(list[4].service).toBe('user-service');
  });

  it('returns empty list for empty groups', () => {
    expect(buildFlatList([])).toEqual([]);
  });

  it('handles group with no services', () => {
    const groups = [{ file: '/a.yml', label: 'a', services: [], error: null }];
    expect(buildFlatList(groups)).toEqual([]);
  });
});

describe('moveCursor', () => {
  it('moves cursor down', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = buildFlatList(createMockGroups());
    state.cursor = 0;

    moveCursor(state, 1);
    expect(state.cursor).toBe(1);
  });

  it('moves cursor up', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = buildFlatList(createMockGroups());
    state.cursor = 2;

    moveCursor(state, -1);
    expect(state.cursor).toBe(1);
  });

  it('clamps at top boundary', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = buildFlatList(createMockGroups());
    state.cursor = 0;

    moveCursor(state, -1);
    expect(state.cursor).toBe(0);

    moveCursor(state, -10);
    expect(state.cursor).toBe(0);
  });

  it('clamps at bottom boundary', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = buildFlatList(createMockGroups());
    state.cursor = 4; // last item (5 total)

    moveCursor(state, 1);
    expect(state.cursor).toBe(4);

    moveCursor(state, 100);
    expect(state.cursor).toBe(4);
  });

  it('does nothing on empty list', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = [];
    state.cursor = 0;

    moveCursor(state, 1);
    expect(state.cursor).toBe(0);
  });
});

describe('selectedEntry', () => {
  it('returns entry at cursor position', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = buildFlatList(createMockGroups());
    state.cursor = 2;

    const entry = selectedEntry(state);
    expect(entry).not.toBeNull();
    expect(entry!.service).toBe('api-gateway');
    expect(entry!.groupIdx).toBe(1);
  });

  it('returns null when flatList is empty', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = [];
    state.cursor = 0;

    expect(selectedEntry(state)).toBeNull();
  });

  it('returns null when cursor is out of bounds', () => {
    const config = createTestConfig();
    const state = createState(config);
    state.flatList = buildFlatList(createMockGroups());
    state.cursor = 99;

    expect(selectedEntry(state)).toBeNull();
  });
});

describe('worktreeLabel', () => {
  it('returns branch name as-is', () => {
    expect(worktreeLabel('main')).toBe('main');
  });

  it('returns feature branch name', () => {
    expect(worktreeLabel('fix-bug')).toBe('fix-bug');
  });

  it('returns empty string for null', () => {
    expect(worktreeLabel(null)).toBe('');
  });
});

describe('getEffectiveFile', () => {
  it('returns original file when no override exists', () => {
    const config = createTestConfig();
    const state = createState(config);
    expect(getEffectiveFile(state, '/path/to/compose.yml', 'web')).toBe('/path/to/compose.yml');
  });

  it('returns override file when override exists', () => {
    const config = createTestConfig();
    const state = createState(config);
    const sk = statusKey('/path/to/compose.yml', 'web');
    state.worktreeOverrides.set(sk, '/other/worktree/compose.yml');
    expect(getEffectiveFile(state, '/path/to/compose.yml', 'web')).toBe('/other/worktree/compose.yml');
  });

  it('does not affect other services', () => {
    const config = createTestConfig();
    const state = createState(config);
    const sk = statusKey('/path/to/compose.yml', 'web');
    state.worktreeOverrides.set(sk, '/other/worktree/compose.yml');
    expect(getEffectiveFile(state, '/path/to/compose.yml', 'api')).toBe('/path/to/compose.yml');
  });
});
