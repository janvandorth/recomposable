import path from 'path';
import { MODE, type Config, type AppState, type ServiceGroup, type FlatEntry } from './types.js';

export { MODE };

export function createState(config: Config): AppState {
  return {
    mode: MODE.LIST,
    groups: [],
    flatList: [],
    cursor: 0,
    statuses: new Map(),
    rebuilding: new Map(),
    restarting: new Map(),
    stopping: new Map(),
    starting: new Map(),
    containerStats: new Map(),
    containerStatsHistory: new Map(),
    logChild: null,
    scrollOffset: 0,
    noCache: false,
    noDeps: true,
    showBottomLogs: true,
    bottomLogLines: new Map(),
    bottomLogTails: new Map(),
    selectedLogKey: null,
    bottomLogLoading: false,
    animDots: 0,
    animTimer: null,
    logCounts: new Map(),
    logLines: [],
    logScrollOffset: 0,
    logAutoScroll: true,
    logSearchQuery: '',
    logSearchActive: false,
    logSearchMatches: [],
    logSearchMatchIdx: -1,
    logFetchedTailCount: 0,
    logHistoryLoaded: false,
    logHistoryLoading: false,
    logSearchPending: false,
    logBuildKey: null,
    logHistoryChild: null,
    bottomSearchQuery: '',
    bottomSearchActive: false,
    bottomSearchLoading: false,
    bottomSearchChild: null,
    bottomSearchTotalMatches: 0,
    bottomSearchSavedLines: new Map(),
    // Watch
    watching: new Map(),
    watchAvailable: null,
    // Dependency-aware rebuild
    depGraphs: new Map(),
    cascading: new Map(),
    // Exec
    execActive: false,
    execInput: '',
    execHistory: [],
    execHistoryIdx: -1,
    execContainerId: null,
    execService: null,
    execChild: null,
    execOutputLines: [],
    execCwd: null,
    showWorktreeColumn: false,
    // Worktree switching
    worktreeOverrides: new Map(),
    // Worktree picker
    worktreePickerActive: false,
    worktreePickerEntries: [],
    worktreePickerCursor: 0,
    worktreePickerCurrentPath: null,
    multiSelected: new Set(),
    config,
  };
}

export function statusKey(file: string, service: string): string {
  return `${file}::${service}`;
}

export function buildFlatList(groups: ServiceGroup[]): FlatEntry[] {
  const list: FlatEntry[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    for (let si = 0; si < g.services.length; si++) {
      list.push({ groupIdx: gi, serviceIdx: si, service: g.services[si], file: g.file });
    }
  }
  return list;
}

export function moveCursor(state: AppState, delta: number): void {
  if (state.flatList.length === 0) return;
  state.cursor = Math.max(0, Math.min(state.flatList.length - 1, state.cursor + delta));
}

export function selectedEntry(state: AppState): FlatEntry | null {
  return state.flatList[state.cursor] || null;
}

export function getEffectiveFile(state: AppState, file: string, service: string): string {
  return state.worktreeOverrides.get(statusKey(file, service)) || file;
}

/** Docker Compose project name derived from compose file's parent directory. */
export function composeProjectName(file: string): string {
  return path.basename(path.dirname(path.resolve(file))).toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/**
 * Returns the effective compose file and, when a worktree override is active,
 * the project name from the *original* file so that Docker Compose targets the
 * same project regardless of which worktree is in use.
 */
export function getComposeTarget(state: AppState, file: string, service: string): { file: string; projectName: string | undefined } {
  const effectiveFile = getEffectiveFile(state, file, service);
  const projectName = effectiveFile !== file ? composeProjectName(file) : undefined;
  return { file: effectiveFile, projectName };
}

export function worktreeLabel(worktree: string | null): string {
  return worktree || '';
}
