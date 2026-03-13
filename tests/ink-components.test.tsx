import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { Text, Box } from 'ink';
import { ThemeContext, DARK_INK_PALETTE, type InkPalette } from '../src/lib/inkTheme.js';
import { Logo } from '../src/components/Logo.js';
import { Separator } from '../src/components/Separator.js';
import { Legend } from '../src/components/Legend.js';
import { ServiceRow } from '../src/components/ServiceRow.js';
import { BottomPanel } from '../src/components/BottomPanel.js';
import { ListScreen } from '../src/components/ListScreen.js';
import { LogScreen } from '../src/components/LogScreen.js';
import { ExecScreen } from '../src/components/ExecScreen.js';
import { App } from '../src/components/App.js';
import { createTestState, createMockStatus, createMockKillable } from './helpers.js';
import { statusKey } from '../src/lib/state.js';

// Strip ANSI codes from ink output
function strip(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

function withTheme(component: React.ReactElement, palette: InkPalette = DARK_INK_PALETTE): React.ReactElement {
  return React.createElement(ThemeContext.Provider, { value: palette }, component);
}

describe('Logo component', () => {
  it('renders the logo text', () => {
    const { lastFrame } = render(withTheme(React.createElement(Logo)));
    const text = strip(lastFrame()!);
    expect(text).toContain('docker compose manager');
  });

  it('renders box drawing characters', () => {
    const { lastFrame } = render(withTheme(React.createElement(Logo)));
    const text = lastFrame()!;
    expect(text).toContain('\u250C');
    expect(text).toContain('\u2500');
  });
});

describe('Separator component', () => {
  it('renders a line of box-drawing characters', () => {
    const { lastFrame } = render(withTheme(
      React.createElement(Separator, { columns: 40 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('\u2500');
    // Should have 38 dashes (columns - 2)
    const dashes = (text.match(/\u2500/g) || []).length;
    expect(dashes).toBe(38);
  });
});

describe('Legend component', () => {
  it('renders list mode legend by default', () => {
    const { lastFrame } = render(withTheme(React.createElement(Legend, {})));
    const text = strip(lastFrame()!);
    // Ink wraps text across lines, so check for key fragments
    expect(text).toContain('Re[B]');
    expect(text).toContain('Re[S]t');
    expect(text).toContain('[Q]u');
  });

  it('renders logs scroll mode legend', () => {
    const { lastFrame } = render(withTheme(
      React.createElement(Legend, { logsScrollMode: true })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('[Esc] back');
    expect(text).toContain('[j/k] scroll');
    expect(text).toContain('[/] search');
  });

  it('renders exec mode legend', () => {
    const { lastFrame } = render(withTheme(
      React.createElement(Legend, { execMode: true })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('[Esc] back');
    expect(text).toContain('[Enter] run');
    expect(text).toContain('[Ctrl+C] kill');
  });

  it('renders worktree picker legend', () => {
    const { lastFrame } = render(withTheme(
      React.createElement(Legend, { worktreePickerActive: true })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('[Esc] cancel');
    expect(text).toContain('[Enter] switch');
    expect(text).toContain('[j/k] navigate');
  });

  it('renders custom actions', () => {
    const { lastFrame } = render(withTheme(
      React.createElement(Legend, {
        customActions: [
          { key: '1', label: 'iTerm tab', command: 'open' },
        ],
      })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('[1]');
    expect(text).toContain('iTerm');
  });

  it('shows clear search when hasLogSearch in scroll mode', () => {
    const { lastFrame } = render(withTheme(
      React.createElement(Legend, { logsScrollMode: true, hasLogSearch: true })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('[Esc] clear search');
  });

  it('shows Stop [B]uild when buildingActive', () => {
    const { lastFrame } = render(withTheme(
      React.createElement(Legend, { buildingActive: true })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('Stop');
    expect(text).toContain('[B]');
  });
});

describe('ServiceRow component', () => {
  it('renders service name', () => {
    const state = createTestState();
    const entry = state.flatList[0];
    const { lastFrame } = render(withTheme(
      React.createElement(ServiceRow, { entry, state, isSelected: false })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('postgres');
  });

  it('shows running status', () => {
    const state = createTestState();
    const entry = state.flatList[0];
    const { lastFrame } = render(withTheme(
      React.createElement(ServiceRow, { entry, state, isSelected: false })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('running');
  });

  it('shows REBUILDING status', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.rebuilding.set(sk, createMockKillable());
    const entry = state.flatList[0];
    const { lastFrame } = render(withTheme(
      React.createElement(ServiceRow, { entry, state, isSelected: false })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('REBUILDING.');
  });

  it('shows ports', () => {
    const state = createTestState();
    const entry = state.flatList[0];
    const { lastFrame } = render(withTheme(
      React.createElement(ServiceRow, { entry, state, isSelected: false })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('8080');
  });

  it('shows CPU/MEM stats', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.containerStats.set(sk, { cpuPercent: 5.3, memUsageBytes: 256 * 1024 * 1024 });
    const entry = state.flatList[0];
    const { lastFrame } = render(withTheme(
      React.createElement(ServiceRow, { entry, state, isSelected: false })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('5.3%');
    expect(text).toContain('256M');
  });

  it('shows worktree column when enabled', () => {
    const state = createTestState();
    state.showWorktreeColumn = true;
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.statuses.set(sk, createMockStatus({ worktree: 'fix-bug' }));
    const entry = state.flatList[0];
    const { lastFrame } = render(withTheme(
      React.createElement(ServiceRow, { entry, state, isSelected: false })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('fix-bug');
  });
});

describe('BottomPanel component', () => {
  it('renders log panel with service name', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['log line 1', 'log line 2'],
    });
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('logs');
    expect(text).toContain('postgres');
    expect(text).toContain('log line 1');
    expect(text).toContain('log line 2');
  });

  it('shows rebuilding action', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'rebuilding',
      service: 'postgres',
      lines: ['Step 1/3'],
    });
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('Build logs');
    expect(text).toContain('Step 1/3');
  });

  it('shows build_failed as SWITCH FAILED', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'switch_failed',
      service: 'postgres',
      lines: ['compose file not found'],
    });
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('SWITCH FAILED');
  });

  it('shows search info', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['error occurred'],
    });
    state.bottomSearchQuery = 'error';
    state.bottomSearchActive = false;
    state.bottomSearchTotalMatches = 42;
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('42 matches in full log');
  });

  it('shows search prompt when active', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.bottomLogLines.set(sk, {
      action: 'logs',
      service: 'postgres',
      lines: ['test'],
    });
    state.bottomSearchActive = true;
    state.bottomSearchQuery = 'err';
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('/err_');
  });

  it('shows worktree picker', () => {
    const state = createTestState();
    state.worktreePickerActive = true;
    state.worktreePickerEntries = [
      { path: '/home/user/main', branch: 'main' },
      { path: '/home/user/fix', branch: 'fix-bug' },
    ];
    state.worktreePickerCursor = 1;
    state.worktreePickerCurrentPath = '/home/user/main';
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('switch worktree');
    expect(text).toContain('main');
    expect(text).toContain('fix-bug');
    expect(text).toContain('(current)');
  });

  it('returns null when bottom logs disabled and no special mode', () => {
    const state = createTestState();
    state.showBottomLogs = false;
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    // Should render nothing meaningful
    const text = strip(lastFrame()!);
    expect(text.trim()).toBe('');
  });

  it('shows cascade progress', () => {
    const state = createTestState();
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.selectedLogKey = sk;
    state.cascading.set(sk, {
      steps: [
        { action: 'rebuild', service: 'postgres', status: 'completed' },
        { action: 'restart', service: 'api-gateway', status: 'in_progress' },
        { action: 'restart', service: 'auth-service', status: 'pending' },
      ],
      currentStepIdx: 1,
      child: null,
    });
    state.bottomLogLines.set(sk, {
      action: 'cascading',
      service: 'postgres',
      lines: [],
    });
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('cascading');
    expect(text).toContain('[done]');
    expect(text).toContain('[>>> ]');
  });

  it('shows exec inline panel', () => {
    const state = createTestState();
    state.execActive = true;
    state.execService = 'postgres';
    state.execInput = 'ls -la';
    state.execOutputLines = ['total 42', 'drwxr-xr-x'];
    const { lastFrame } = render(withTheme(
      React.createElement(BottomPanel, { state, columns: 120 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('exec');
    expect(text).toContain('postgres');
    expect(text).toContain('$ ls -la_');
    expect(text).toContain('total 42');
  });
});

describe('LogScreen component', () => {
  it('renders log view with service name', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['line 1', 'line 2'];
    const { lastFrame } = render(withTheme(
      React.createElement(LogScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('docker compose manager');
    expect(text).toContain('postgres');
    expect(text).toContain('line 1');
    expect(text).toContain('line 2');
  });

  it('shows live status when auto-scrolling', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logAutoScroll = true;
    state.logLines = ['test'];
    const { lastFrame } = render(withTheme(
      React.createElement(LogScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('live');
  });

  it('shows paused status', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logAutoScroll = false;
    state.logScrollOffset = 5;
    state.logLines = Array(20).fill('log line');
    const { lastFrame } = render(withTheme(
      React.createElement(LogScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('paused');
  });

  it('shows search prompt when active', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['test'];
    state.logSearchActive = true;
    state.logSearchQuery = 'err';
    const { lastFrame } = render(withTheme(
      React.createElement(LogScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('/err_');
  });

  it('shows match count', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    state.logLines = ['match here', 'no match', 'match too'];
    state.logSearchQuery = 'match';
    state.logSearchMatches = [0, 2];
    state.logSearchMatchIdx = 0;
    const { lastFrame } = render(withTheme(
      React.createElement(LogScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('match 1/2');
  });

  it('shows build status header', () => {
    const state = createTestState();
    state.mode = 'LOGS';
    const sk = statusKey(state.groups[0].file, 'postgres');
    state.logBuildKey = sk;
    state.rebuilding.set(sk, createMockKillable());
    state.logLines = ['build output'];
    const { lastFrame } = render(withTheme(
      React.createElement(LogScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('Build logs');
    expect(text).toContain('postgres');
  });
});

describe('ExecScreen component', () => {
  it('renders exec view with service name', () => {
    const state = createTestState();
    state.mode = 'EXEC';
    state.execService = 'postgres';
    state.execInput = 'pwd';
    state.execOutputLines = ['output line'];
    const { lastFrame } = render(withTheme(
      React.createElement(ExecScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('exec');
    expect(text).toContain('postgres');
    expect(text).toContain('$ pwd_');
    expect(text).toContain('output line');
  });

  it('shows running indicator when exec child exists', () => {
    const state = createTestState();
    state.mode = 'EXEC';
    state.execService = 'postgres';
    state.execChild = { kill: vi.fn() } as any;
    state.execInput = '';
    const { lastFrame } = render(withTheme(
      React.createElement(ExecScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('running');
  });

  it('shows ready indicator when no exec child', () => {
    const state = createTestState();
    state.mode = 'EXEC';
    state.execService = 'postgres';
    state.execChild = null;
    state.execInput = '';
    const { lastFrame } = render(withTheme(
      React.createElement(ExecScreen, { state, columns: 120, rows: 30 })
    ));
    const text = strip(lastFrame()!);
    expect(text).toContain('ready');
  });
});
