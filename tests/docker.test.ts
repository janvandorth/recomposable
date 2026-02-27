import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseMemString, parseStatsLine } from '../src/lib/docker';

// We test the pure functions directly. The functions that call child_process
// are tested by mocking execFileSync/spawn.

describe('parseMemString', () => {
  it('parses MiB values', () => {
    expect(parseMemString('256MiB')).toBe(256 * 1024 * 1024);
  });

  it('parses GiB values', () => {
    expect(parseMemString('1.5GiB')).toBe(1.5 * 1024 * 1024 * 1024);
  });

  it('parses KiB values', () => {
    expect(parseMemString('512KiB')).toBe(512 * 1024);
  });

  it('parses B values', () => {
    expect(parseMemString('1024B')).toBe(1024);
  });

  it('parses TiB values', () => {
    expect(parseMemString('2TiB')).toBe(2 * 1024 * 1024 * 1024 * 1024);
  });

  it('parses SI kB values', () => {
    expect(parseMemString('500kB')).toBe(500 * 1000);
  });

  it('parses SI MB values', () => {
    expect(parseMemString('100MB')).toBe(100 * 1e6);
  });

  it('parses SI GB values', () => {
    expect(parseMemString('2GB')).toBe(2 * 1e9);
  });

  it('parses SI TB values', () => {
    expect(parseMemString('1TB')).toBe(1e12);
  });

  it('returns 0 for null', () => {
    expect(parseMemString(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(parseMemString(undefined)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseMemString('')).toBe(0);
  });

  it('returns 0 for invalid format', () => {
    expect(parseMemString('abc')).toBe(0);
    expect(parseMemString('123')).toBe(0);
    expect(parseMemString('123XB')).toBe(0);
  });

  it('handles decimal values', () => {
    const result = parseMemString('1.5MiB');
    expect(result).toBe(1.5 * 1024 * 1024);
  });

  it('handles case insensitivity', () => {
    expect(parseMemString('100mib')).toBe(100 * 1024 * 1024);
  });
});

describe('parseStatsLine', () => {
  it('parses valid JSON stats line', () => {
    const json = JSON.stringify({
      ID: 'abc123',
      Name: 'my-container',
      CPUPerc: '5.32%',
      MemUsage: '256MiB / 1GiB',
    });
    const result = parseStatsLine(json);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('abc123');
    expect(result!.name).toBe('my-container');
    expect(result!.cpuPercent).toBeCloseTo(5.32);
    expect(result!.memUsageBytes).toBe(256 * 1024 * 1024);
  });

  it('returns null for malformed JSON', () => {
    expect(parseStatsLine('not json')).toBeNull();
    expect(parseStatsLine('{invalid}')).toBeNull();
  });

  it('handles missing fields gracefully', () => {
    const json = JSON.stringify({});
    const result = parseStatsLine(json);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('');
    expect(result!.name).toBe('');
    expect(result!.cpuPercent).toBe(0);
    expect(result!.memUsageBytes).toBe(0);
  });

  it('handles CPU percentage without % sign', () => {
    const json = JSON.stringify({ CPUPerc: '10.5', ID: 'x' });
    const result = parseStatsLine(json);
    expect(result!.cpuPercent).toBeCloseTo(10.5);
  });

  it('handles MemUsage with only usage part', () => {
    const json = JSON.stringify({ MemUsage: '128MiB', ID: 'x' });
    const result = parseStatsLine(json);
    expect(result!.memUsageBytes).toBe(128 * 1024 * 1024);
  });
});

describe('listServices (mocked)', () => {
  let execFileSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    execFileSyncMock = vi.fn();
    vi.doMock('child_process', () => ({
      execFileSync: execFileSyncMock,
      spawn: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trims and splits output into service names', async () => {
    execFileSyncMock.mockReturnValue('web\napi\nworker\n');
    const { listServices } = await import('../src/lib/docker');
    const result = listServices('/path/to/compose.yml');
    expect(result).toEqual(['web', 'api', 'worker']);
  });

  it('filters empty lines', async () => {
    execFileSyncMock.mockReturnValue('web\n\napi\n');
    const { listServices } = await import('../src/lib/docker');
    const result = listServices('/path/to/compose.yml');
    expect(result).toEqual(['web', 'api']);
  });

  it('passes correct args to docker', async () => {
    execFileSyncMock.mockReturnValue('web\n');
    const { listServices } = await import('../src/lib/docker');
    listServices('/path/to/compose.yml');
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['compose', '-f', expect.any(String), 'config', '--services']),
      expect.objectContaining({ encoding: 'utf8', timeout: 10000 }),
    );
  });
});

describe('getStatuses (mocked)', () => {
  let execFileSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    execFileSyncMock = vi.fn();
    vi.doMock('child_process', () => ({
      execFileSync: execFileSyncMock,
      spawn: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses JSON array format', async () => {
    const data = [
      { Service: 'web', State: 'running', Health: 'healthy', CreatedAt: '2024-01-01', ID: 'abc123', Publishers: [{ PublishedPort: 8080, TargetPort: 80 }] },
    ];
    execFileSyncMock
      .mockReturnValueOnce(JSON.stringify(data))
      .mockReturnValueOnce(JSON.stringify([{ Id: 'abc123full', State: { StartedAt: '2024-01-01T10:00:00Z' } }]));

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.size).toBe(1);
    const status = result.get('web');
    expect(status).toBeDefined();
    expect(status!.state).toBe('running');
    expect(status!.health).toBe('healthy');
    expect(status!.ports).toEqual([{ published: 8080, target: 80 }]);
  });

  it('extracts workingDir from inspect labels and resolves worktree', async () => {
    const data = [
      { Service: 'web', State: 'running', Health: '', ID: 'abc123', Publishers: [] },
    ];
    execFileSyncMock
      .mockReturnValueOnce(JSON.stringify(data))
      .mockReturnValueOnce(JSON.stringify([{
        Id: 'abc123full',
        State: { StartedAt: '2024-01-01T10:00:00Z' },
        Config: { Labels: { 'com.docker.compose.project.working_dir': '/home/user/project' } },
      }]))
      .mockReturnValueOnce('main\n');

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.get('web')!.workingDir).toBe('/home/user/project');
    expect(result.get('web')!.worktree).toBe('main');
  });

  it('sets workingDir and worktree to null when no labels', async () => {
    const data = [
      { Service: 'web', State: 'running', Health: '', ID: 'abc123', Publishers: [] },
    ];
    execFileSyncMock
      .mockReturnValueOnce(JSON.stringify(data))
      .mockReturnValueOnce(JSON.stringify([{
        Id: 'abc123full',
        State: { StartedAt: '2024-01-01T10:00:00Z' },
      }]));

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.get('web')!.workingDir).toBeNull();
    expect(result.get('web')!.worktree).toBeNull();
  });

  it('parses NDJSON format', async () => {
    const line1 = JSON.stringify({ Service: 'web', State: 'running', Health: '', ID: 'abc', Publishers: [] });
    const line2 = JSON.stringify({ Service: 'api', State: 'exited', Health: '', ID: 'def', Publishers: [] });
    execFileSyncMock
      .mockReturnValueOnce(`${line1}\n${line2}\n`)
      .mockReturnValueOnce(JSON.stringify([]));

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.size).toBe(2);
    expect(result.get('web')!.state).toBe('running');
    expect(result.get('api')!.state).toBe('exited');
  });

  it('parses ports from Ports string fallback', async () => {
    const data = [
      { Service: 'web', State: 'running', Health: '', ID: 'abc', Ports: '0.0.0.0:3000->3000/tcp, 0.0.0.0:3001->3001/tcp' },
    ];
    execFileSyncMock
      .mockReturnValueOnce(JSON.stringify(data))
      .mockReturnValueOnce(JSON.stringify([]));

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    const status = result.get('web')!;
    expect(status.ports).toEqual([
      { published: 3000, target: 3000 },
      { published: 3001, target: 3001 },
    ]);
  });

  it('deduplicates ports by published port', async () => {
    const data = [
      { Service: 'web', State: 'running', Health: '', ID: 'abc', Publishers: [
        { PublishedPort: 8080, TargetPort: 80 },
        { PublishedPort: 8080, TargetPort: 80 },
        { PublishedPort: 443, TargetPort: 443 },
      ] },
    ];
    execFileSyncMock
      .mockReturnValueOnce(JSON.stringify(data))
      .mockReturnValueOnce(JSON.stringify([]));

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.get('web')!.ports).toHaveLength(2);
  });

  it('returns empty map on exec failure', async () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('fail'); });

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.size).toBe(0);
  });

  it('returns empty map on invalid JSON', async () => {
    execFileSyncMock.mockReturnValue('not json at all');

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.size).toBe(0);
  });

  it('returns empty map on empty output', async () => {
    execFileSyncMock.mockReturnValue('');

    const { getStatuses } = await import('../src/lib/docker');
    const result = getStatuses('/path/to/compose.yml');
    expect(result.size).toBe(0);
  });
});

describe('rebuildService (mocked)', () => {
  let spawnMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    spawnMock = vi.fn().mockReturnValue({
      stdout: { on: vi.fn(), pipe: vi.fn() },
      stderr: { on: vi.fn(), pipe: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    });
    vi.doMock('child_process', () => ({
      execFileSync: vi.fn(),
      spawn: spawnMock,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns docker compose up -d --build without noCache', async () => {
    const { rebuildService } = await import('../src/lib/docker');
    rebuildService('/path/to/compose.yml', 'web');
    expect(spawnMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['compose', '-f', expect.any(String), 'up', '-d', '--build', 'web']),
      expect.any(Object),
    );
  });

  it('spawns build --no-cache first with noCache option', async () => {
    const { rebuildService } = await import('../src/lib/docker');
    const child = rebuildService('/path/to/compose.yml', 'web', { noCache: true });
    expect(spawnMock).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['compose', '-f', expect.any(String), 'build', '--no-cache', 'web']),
      expect.any(Object),
    );
    // Should return an EventEmitter-like object with stdout/stderr
    expect(child.stdout).toBeDefined();
    expect(child.stderr).toBeDefined();
  });
});

describe('getContainerId (mocked)', () => {
  let execFileSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    execFileSyncMock = vi.fn();
    vi.doMock('child_process', () => ({
      execFileSync: execFileSyncMock,
      spawn: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns trimmed container ID on success', async () => {
    execFileSyncMock.mockReturnValue('abc123def456\n');
    const { getContainerId } = await import('../src/lib/docker');
    expect(getContainerId('/path/to/compose.yml', 'web')).toBe('abc123def456');
  });

  it('returns null on empty output', async () => {
    execFileSyncMock.mockReturnValue('');
    const { getContainerId } = await import('../src/lib/docker');
    expect(getContainerId('/path/to/compose.yml', 'web')).toBeNull();
  });

  it('returns null on error', async () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('fail'); });
    const { getContainerId } = await import('../src/lib/docker');
    expect(getContainerId('/path/to/compose.yml', 'web')).toBeNull();
  });
});

describe('getGitRoot (mocked)', () => {
  let execFileSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    execFileSyncMock = vi.fn();
    vi.doMock('child_process', () => ({
      execFileSync: execFileSyncMock,
      spawn: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns trimmed git root path', async () => {
    execFileSyncMock.mockReturnValue('/home/user/project\n');
    const { getGitRoot } = await import('../src/lib/docker');
    expect(getGitRoot('/home/user/project/src')).toBe('/home/user/project');
  });

  it('returns null on error', async () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('not a git repo'); });
    const { getGitRoot } = await import('../src/lib/docker');
    expect(getGitRoot('/tmp/no-repo')).toBeNull();
  });

  it('returns null on empty output', async () => {
    execFileSyncMock.mockReturnValue('');
    const { getGitRoot } = await import('../src/lib/docker');
    expect(getGitRoot('/tmp')).toBeNull();
  });
});

describe('listGitWorktrees (mocked)', () => {
  let execFileSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    execFileSyncMock = vi.fn();
    vi.doMock('child_process', () => ({
      execFileSync: execFileSyncMock,
      spawn: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses porcelain output with multiple worktrees', async () => {
    const porcelain = [
      'worktree /home/user/project',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /home/user/project-fix',
      'HEAD def456',
      'branch refs/heads/fix-bug',
      '',
    ].join('\n');
    execFileSyncMock.mockReturnValue(porcelain);
    const { listGitWorktrees } = await import('../src/lib/docker');
    const result = listGitWorktrees('/home/user/project');
    expect(result).toEqual([
      { path: '/home/user/project', branch: 'main' },
      { path: '/home/user/project-fix', branch: 'fix-bug' },
    ]);
  });

  it('filters out bare repos', async () => {
    const porcelain = [
      'worktree /home/user/project.git',
      'HEAD abc123',
      'bare',
      '',
      'worktree /home/user/project',
      'HEAD def456',
      'branch refs/heads/main',
      '',
    ].join('\n');
    execFileSyncMock.mockReturnValue(porcelain);
    const { listGitWorktrees } = await import('../src/lib/docker');
    const result = listGitWorktrees('/home/user/project');
    expect(result).toEqual([
      { path: '/home/user/project', branch: 'main' },
    ]);
  });

  it('returns empty array on error', async () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('fail'); });
    const { listGitWorktrees } = await import('../src/lib/docker');
    expect(listGitWorktrees('/tmp')).toEqual([]);
  });

  it('returns empty array for empty output', async () => {
    execFileSyncMock.mockReturnValue('');
    const { listGitWorktrees } = await import('../src/lib/docker');
    expect(listGitWorktrees('/tmp')).toEqual([]);
  });

  it('skips blocks without branch line', async () => {
    const porcelain = [
      'worktree /home/user/project',
      'HEAD abc123 (detached)',
      '',
      'worktree /home/user/project-fix',
      'HEAD def456',
      'branch refs/heads/fix-bug',
      '',
    ].join('\n');
    execFileSyncMock.mockReturnValue(porcelain);
    const { listGitWorktrees } = await import('../src/lib/docker');
    const result = listGitWorktrees('/home/user/project');
    expect(result).toEqual([
      { path: '/home/user/project-fix', branch: 'fix-bug' },
    ]);
  });
});

describe('validateServiceInComposeFile (mocked)', () => {
  let execFileSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    execFileSyncMock = vi.fn();
    vi.doMock('child_process', () => ({
      execFileSync: execFileSyncMock,
      spawn: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when service exists', async () => {
    execFileSyncMock.mockReturnValue('web\napi\nworker\n');
    const { validateServiceInComposeFile } = await import('../src/lib/docker');
    expect(validateServiceInComposeFile('/path/to/compose.yml', 'api')).toBe(true);
  });

  it('returns false when service does not exist', async () => {
    execFileSyncMock.mockReturnValue('web\napi\nworker\n');
    const { validateServiceInComposeFile } = await import('../src/lib/docker');
    expect(validateServiceInComposeFile('/path/to/compose.yml', 'missing')).toBe(false);
  });

  it('returns false on error', async () => {
    execFileSyncMock.mockImplementation(() => { throw new Error('fail'); });
    const { validateServiceInComposeFile } = await import('../src/lib/docker');
    expect(validateServiceInComposeFile('/path/to/compose.yml', 'web')).toBe(false);
  });
});
