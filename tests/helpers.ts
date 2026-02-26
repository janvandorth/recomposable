import { createState, buildFlatList, statusKey } from '../src/lib/state';
import type { Config, AppState, ServiceGroup, ContainerStatus, Killable } from '../src/lib/types';

export function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    composeFiles: ['test/docker-compose.yml'],
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
    ...overrides,
  };
}

export function createMockGroups(): ServiceGroup[] {
  return [
    {
      file: '/path/to/infra/docker-compose.yml',
      label: 'infra',
      services: ['postgres', 'redis'],
      error: null,
    },
    {
      file: '/path/to/services/docker-compose.yml',
      label: 'services',
      services: ['api-gateway', 'auth-service', 'user-service'],
      error: null,
    },
  ];
}

export function createTestState(overrides: Partial<AppState> = {}): AppState {
  const config = createTestConfig();
  const state = createState(config);
  const groups = createMockGroups();
  state.groups = groups;
  state.flatList = buildFlatList(groups);

  // Set up mock statuses for all services
  for (const group of groups) {
    for (const service of group.services) {
      const sk = statusKey(group.file, service);
      state.statuses.set(sk, createMockStatus());
    }
  }

  return { ...state, ...overrides };
}

export function createMockStatus(overrides: Partial<ContainerStatus> = {}): ContainerStatus {
  return {
    state: 'running',
    health: 'healthy',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    startedAt: new Date(Date.now() - 1800000).toISOString(),
    id: 'abc123',
    ports: [{ published: 8080, target: 8080 }],
    ...overrides,
  };
}

export function createMockKillable(): Killable {
  return { kill: vi.fn() };
}
