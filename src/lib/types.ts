import type { ChildProcess } from 'child_process';
import type { EventEmitter } from 'events';
import type { PassThrough } from 'stream';

// --- Mode ---

export const MODE = { LIST: 'LIST', LOGS: 'LOGS', EXEC: 'EXEC' } as const;
export type Mode = typeof MODE[keyof typeof MODE];

// --- Config ---

export interface Config {
  composeFiles: string[];
  pollInterval: number;
  logTailLines: number;
  logScanPatterns: string[];
  logScanLines: number;
  logScanInterval: number;
  statsInterval: number;
  statsBufferSize: number;
  bottomLogCount: number;
  cpuWarnThreshold: number;
  cpuDangerThreshold: number;
  memWarnThreshold: number;
  memDangerThreshold: number;
}

// --- Port / Status ---

export interface PortMapping {
  published: number;
  target: number;
}

export interface ContainerStatus {
  state: string;
  health: string;
  createdAt: string | null;
  startedAt: string | null;
  id: string | null;
  ports: PortMapping[];
}

export interface ContainerStats {
  cpuPercent: number;
  memUsageBytes: number;
}

export interface StatsHistory {
  cpu: number[];
  mem: number[];
  idx: number;
  count: number;
}

export interface ParsedStatsLine {
  id: string;
  name: string;
  cpuPercent: number;
  memUsageBytes: number;
}

// --- Rebuild emitter (no-cache two-phase build) ---

export interface RebuildEmitter extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  kill(signal?: string): void;
}

export type RebuildChild = ChildProcess | RebuildEmitter;

// --- Killable (for state Maps) ---

export interface Killable {
  kill(signal?: string): void;
}

// --- Service groups & flat list ---

export interface ServiceGroup {
  file: string;
  label: string;
  services: string[];
  error: string | null;
}

export interface FlatEntry {
  groupIdx: number;
  serviceIdx: number;
  service: string;
  file: string;
}

// --- Bottom log panel ---

export type BottomLogAction = 'logs' | 'rebuilding' | 'restarting' | 'stopping' | 'starting' | 'started' | 'watching' | 'cascading' | 'exec' | 'build_failed' | 'restart_failed' | 'stop_failed' | 'start_failed';

// --- Dependency graph ---

export interface DependencyGraph {
  dependsOn: Map<string, string[]>;   // service -> its prerequisites
  dependedBy: Map<string, string[]>;  // service -> services depending on it
}

export interface CascadeStep {
  action: 'rebuild' | 'restart';
  service: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface CascadeOperation {
  steps: CascadeStep[];
  currentStepIdx: number;
  child: ChildProcess | null;
}

export interface BottomLogInfo {
  action: BottomLogAction;
  service: string;
  lines: string[];
}

// --- App state ---

export interface AppState {
  mode: Mode;
  groups: ServiceGroup[];
  flatList: FlatEntry[];
  cursor: number;
  statuses: Map<string, ContainerStatus>;
  rebuilding: Map<string, Killable>;
  restarting: Map<string, Killable>;
  stopping: Map<string, Killable>;
  starting: Map<string, Killable>;
  containerStats: Map<string, ContainerStats>;
  containerStatsHistory: Map<string, StatsHistory>;
  logChild: ChildProcess | null;
  scrollOffset: number;
  noCache: boolean;
  noDeps: boolean;
  showBottomLogs: boolean;
  bottomLogLines: Map<string, BottomLogInfo>;
  bottomLogTails: Map<string, Killable>;
  selectedLogKey: string | null;
  logCounts: Map<string, Map<string, number>>;
  logLines: string[];
  logScrollOffset: number;
  logAutoScroll: boolean;
  logSearchQuery: string;
  logSearchActive: boolean;
  logSearchMatches: number[];
  logSearchMatchIdx: number;
  logFetchedTailCount: number;
  logHistoryLoaded: boolean;
  logHistoryLoading: boolean;
  logSearchPending: boolean;
  logBuildKey: string | null;
  logHistoryChild: ChildProcess | null;
  bottomSearchQuery: string;
  bottomSearchActive: boolean;
  bottomSearchLoading: boolean;
  bottomSearchChild: ChildProcess | null;
  bottomSearchTotalMatches: number;
  bottomSearchSavedLines: Map<string, string[]>;
  // Watch
  watching: Map<string, Killable>;
  watchAvailable: boolean | null;
  // Dependency-aware rebuild
  depGraphs: Map<string, DependencyGraph>;
  cascading: Map<string, CascadeOperation>;
  // Exec
  execActive: boolean;
  execInput: string;
  execHistory: string[];
  execHistoryIdx: number;
  execContainerId: string | null;
  execService: string | null;
  execChild: ChildProcess | null;
  execOutputLines: string[];
  execCwd: string | null;
  config: Config;
  pollTimer?: ReturnType<typeof setInterval>;
  logScanTimer?: ReturnType<typeof setInterval>;
  statsTimer?: ReturnType<typeof setInterval>;
}

// --- Renderer ---

export interface LegendOptions {
  logPanelActive?: boolean;
  fullLogsActive?: boolean;
  logsScrollMode?: boolean;
  hasLogSearch?: boolean;
  noCacheActive?: boolean;
  noDepsActive?: boolean;
  watchActive?: boolean;
  execMode?: boolean;
  execInline?: boolean;
}

export interface DisplayLine {
  type: 'header' | 'colheader' | 'blank' | 'service';
  text: string;
  flatIdx?: number;
}

// --- Docker JSON output types ---

export interface DockerPublisher {
  PublishedPort: number;
  TargetPort: number;
}

export interface DockerComposePsEntry {
  Service?: string;
  Name?: string;
  State?: string;
  Health?: string;
  CreatedAt?: string;
  ID?: string;
  Publishers?: DockerPublisher[];
  Ports?: string;
}

export interface DockerInspectEntry {
  Id?: string;
  State?: {
    StartedAt?: string;
  };
}

export interface DockerStatsJson {
  ID?: string;
  Name?: string;
  CPUPerc?: string;
  MemUsage?: string;
}

// --- Rebuild options ---

export interface RebuildOptions {
  noCache?: boolean;
  noDeps?: boolean;
}
