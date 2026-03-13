import React from 'react';
import { Text, Box } from 'ink';
import { useTheme } from '../lib/inkTheme.js';
import { statusKey } from '../lib/state.js';
import { Separator } from './Separator.js';
import type { AppState } from '../lib/types.js';

function logLineColor(line: string, patterns: (string | string[])[], patternColors: string[]): string | null {
  let color: string | null = null;
  for (let pi = 0; pi < patterns.length; pi++) {
    const group = Array.isArray(patterns[pi]) ? patterns[pi] as string[] : [patterns[pi] as string];
    if (group.some(p => line.includes(p))) {
      color = patternColors[pi % patternColors.length];
    }
  }
  return color;
}

interface BottomPanelProps {
  state: AppState;
  columns: number;
  availableRows?: number;
}

export function BottomPanel({ state, columns, availableRows }: BottomPanelProps): React.ReactElement | null {
  const theme = useTheme();
  const patterns = state.config.logScanPatterns || [];
  const patternColors = [theme.yellow, theme.red, theme.cyan, theme.magenta];

  // Multi-select panel
  if (state.multiSelected.size > 0) {
    const selectionPanel = (
      <React.Fragment key="sel">
        <Separator columns={columns} />
        <Text>
          <Text color={theme.cyan}>{' Selection'}</Text>
          <Text color={theme.dim}>{' - press Esc to discard'}</Text>
        </Text>
        {[...state.multiSelected].map((sk, i) => {
          const entry = state.flatList.find(e => statusKey(e.file, e.service) === sk);
          if (!entry) return null;
          const st = state.statuses.get(sk);
          const isRebuilding = state.rebuilding.has(sk);
          const isRestarting = state.restarting.has(sk);
          const isStopping = state.stopping.has(sk);
          const isStarting = state.starting.has(sk);
          const dots = '.'.repeat(state.animDots + 1);
          let statusStr = '';
          if (isRebuilding) statusStr = ` REBUILDING${dots}`;
          else if (isRestarting) statusStr = ` RESTARTING${dots}`;
          else if (isStopping) statusStr = ` STOPPING${dots}`;
          else if (isStarting) statusStr = ` STARTING${dots}`;
          else if (st) statusStr = ` ${st.state}`;
          return (
            <Text key={i}>
              <Text color={theme.cyan}>{'  \u2713 '}</Text>
              <Text bold>{entry.service}</Text>
              {statusStr && <Text color={isRebuilding || isRestarting || isStopping || isStarting ? theme.yellow : theme.dim}>{statusStr}</Text>}
            </Text>
          );
        })}
      </React.Fragment>
    );

    // If worktree picker is also active, show both panels
    if (state.worktreePickerActive) {
      return (
        <Box flexDirection="column">
          {selectionPanel}
          <Separator columns={columns} />
          <Text>
            <Text color={theme.cyan}>{' switch worktree '}</Text>
            <Text bold color={theme.cyan}>{'selected services'}</Text>
          </Text>
          <Text color={theme.dim}>{'  j/k navigate  Enter confirm  Esc cancel'}</Text>
          {state.worktreePickerEntries.map((wt, wi) => {
            const isSelected = wi === state.worktreePickerCursor;
            const isCurrent = state.worktreePickerCurrentPath !== null && state.worktreePickerCurrentPath === wt.path;
            return (
              <Text key={wi} inverse={isSelected}>
                {'  '}
                {wt.branch}
                {'  '}
                <Text color={theme.dim}>{wt.path}</Text>
                {isCurrent && <Text color={theme.dim}>{' (current)'}</Text>}
              </Text>
            );
          })}
        </Box>
      );
    }

    return <Box flexDirection="column">{selectionPanel}</Box>;
  }

  // Worktree picker (single service)
  if (state.worktreePickerActive) {
    const selEntry = state.flatList[state.cursor];
    if (!selEntry) return null;
    return (
      <Box flexDirection="column">
        <Separator columns={columns} />
        <Text>
          <Text color={theme.cyan}>{' switch worktree '}</Text>
          <Text bold color={theme.cyan}>{selEntry.service}</Text>
        </Text>
        <Text color={theme.dim}>{'  j/k navigate  Enter confirm  Esc cancel'}</Text>
        {state.worktreePickerEntries.map((wt, wi) => {
          const isSelected = wi === state.worktreePickerCursor;
          const isCurrent = state.worktreePickerCurrentPath !== null && state.worktreePickerCurrentPath === wt.path;
          return (
            <Text key={wi} inverse={isSelected}>
              {'  '}
              {wt.branch}
              {'  '}
              <Text color={theme.dim}>{wt.path}</Text>
              {isCurrent && <Text color={theme.dim}>{' (current)'}</Text>}
            </Text>
          );
        })}
      </Box>
    );
  }

  // Exec inline
  if (state.execActive && state.execService) {
    const runningIndicator = state.execChild ? 'running' : 'ready';
    const runningColor = state.execChild ? theme.yellow : theme.green;
    const execChrome = 3; // separator + header + input prompt
    const maxOutputLines = availableRows ? Math.max(1, availableRows - execChrome) : Math.max(1, (state.config.bottomLogCount || 10) - 1);
    const outputStart = Math.max(0, state.execOutputLines.length - maxOutputLines);
    return (
      <Box flexDirection="column">
        <Separator columns={columns} />
        <Text>
          <Text color={theme.cyan}>{' exec '}</Text>
          <Text bold color={theme.cyan}>{state.execService}</Text>
          <Text>{'  '}</Text>
          <Text color={runningColor}>{runningIndicator}</Text>
          {state.execCwd && <Text color={theme.dim}>{'  ' + state.execCwd}</Text>}
        </Text>
        {state.execOutputLines.slice(outputStart).map((line, i) => (
          <Text key={i}>{'  ' + line.substring(0, columns - 4)}</Text>
        ))}
        <Text>
          <Text color={theme.green}>{'$ '}</Text>
          <Text>{state.execInput}</Text>
          <Text bold>{'_'}</Text>
        </Text>
      </Box>
    );
  }

  // Bottom logs
  if (!state.showBottomLogs) return null;

  const selEntry = state.flatList[state.cursor];
  if (!selEntry) return null;

  const sk = statusKey(selEntry.file, selEntry.service);
  const parts: React.ReactElement[] = [];

  // Cascade progress
  const cascade = state.cascading.get(sk);
  if (cascade) {
    parts.push(
      <Separator key="cas-sep" columns={columns} />,
      <Text key="cas-hdr">
        <Text color={theme.yellow}>{' cascading '}</Text>
        <Text bold color={theme.yellow}>{selEntry.service}</Text>
      </Text>
    );
    cascade.steps.forEach((step, si) => {
      let marker: string;
      let markerColor: string;
      switch (step.status) {
        case 'completed': marker = '[done]'; markerColor = theme.green; break;
        case 'in_progress': marker = '[>>> ]'; markerColor = theme.yellow; break;
        case 'failed': marker = '[FAIL]'; markerColor = theme.red; break;
        default: marker = '[    ]'; markerColor = theme.dim;
      }
      parts.push(
        <Text key={`cas-${si}`}>
          {'  '}
          <Text color={markerColor}>{marker}</Text>
          {' ' + step.action + ' '}
          <Text bold>{step.service}</Text>
        </Text>
      );
    });
  }

  const info = state.bottomLogLines.get(sk);

  // Show animated "loading logs" while debouncing (before tail starts)
  if (!info && !cascade && state.bottomLogLoading) {
    const dots = '.'.repeat(state.animDots + 1);
    parts.push(
      <Separator key="log-sep" columns={columns} />,
      <Text key="loading" color={theme.dim}>{'  loading logs' + dots}</Text>
    );
  }

  if (info) {
    if (!cascade) {
      parts.push(<Separator key="log-sep" columns={columns} />);
    }

    const isFailed = info.action === 'build_failed' || info.action === 'restart_failed' || info.action === 'stop_failed' || info.action === 'start_failed' || info.action === 'switch_failed';
    const isInProgress = info.action === 'rebuilding' || info.action === 'restarting' || info.action === 'stopping' || info.action === 'starting' || info.action === 'cascading' || info.action === 'switching';
    const actionColor = isFailed ? theme.red
      : isInProgress ? theme.yellow
      : info.action === 'watching' ? theme.cyan : theme.green;

    // Human-friendly labels
    let actionLabel: string;
    if (isFailed) {
      actionLabel = info.action.replace('_', ' ').toUpperCase();
    } else if (info.action === 'rebuilding') {
      actionLabel = 'Build logs';
    } else if (info.action === 'restarting') {
      actionLabel = 'Restarting';
    } else if (info.action === 'switching') {
      actionLabel = 'Switching';
    } else if (info.action === 'logs' || info.action === 'started') {
      actionLabel = 'Run logs';
    } else {
      actionLabel = info.action;
    }

    // For switching, extract worktree target from first log line
    let switchTarget = '';
    if (info.action === 'switching' && info.lines.length > 0) {
      const m = info.lines[0].match(/"([^"]+)"/);
      if (m) switchTarget = m[1];
    }

    const bq = state.bottomSearchQuery || '';
    parts.push(
      <Text key="log-hdr">
        <Text color={actionColor}>{' ' + actionLabel + ' '}</Text>
        <Text bold color={actionColor}>{info.service}</Text>
        {switchTarget && <Text color={actionColor}>{' to '}<Text bold>{switchTarget}</Text></Text>}
        {bq && !state.bottomSearchActive && state.bottomSearchLoading && (
          <Text color={theme.yellow}>{'  searching "' + bq + '"...'}</Text>
        )}
        {bq && !state.bottomSearchActive && !state.bottomSearchLoading && state.bottomSearchTotalMatches > 0 && (
          <Text color={theme.dim}>{'  search: "' + bq + '" (' + state.bottomSearchTotalMatches + ' match' + (state.bottomSearchTotalMatches !== 1 ? 'es' : '') + ' in full log)'}</Text>
        )}
        {bq && !state.bottomSearchActive && !state.bottomSearchLoading && state.bottomSearchTotalMatches === 0 && (
          <Text color={theme.red}>{'  search: "' + bq + '" (no matches)'}</Text>
        )}
      </Text>
    );

    if (info.lines.length === 0 && (info.action === 'logs' || info.action === 'started')) {
      const dots = '.'.repeat(state.animDots + 1);
      parts.push(<Text key="loading" color={theme.dim}>{'  loading' + dots}</Text>);
    }

    // Chrome: separator (1) + header (1) + optional search prompt (1) + optional cascade lines
    let chromeLines = 2;
    if (cascade) chromeLines += 2 + cascade.steps.length;
    if (state.bottomSearchActive) chromeLines += 1;
    const maxBottomLines = availableRows ? Math.max(1, availableRows - chromeLines) : (state.config.bottomLogCount || 10);
    const visibleLines = info.lines.slice(-maxBottomLines);
    const searchQuery = bq && !state.bottomSearchActive ? bq : '';

    visibleLines.forEach((line, li) => {
      const coloredLine = line.substring(0, columns - 4);
      const lineColor = logLineColor(coloredLine, patterns, patternColors) || theme.dim;

      if (searchQuery) {
        const lowerLine = coloredLine.toLowerCase();
        const lowerQ = searchQuery.toLowerCase();
        if (lowerLine.includes(lowerQ)) {
          // Render with search highlights
          const segments: React.ReactElement[] = [];
          let pos = 0;
          let segIdx = 0;
          while (pos < coloredLine.length) {
            const idx = lowerLine.indexOf(lowerQ, pos);
            if (idx === -1) {
              segments.push(<Text key={segIdx++} color={lineColor}>{coloredLine.substring(pos)}</Text>);
              break;
            }
            if (idx > pos) {
              segments.push(<Text key={segIdx++} color={lineColor}>{coloredLine.substring(pos, idx)}</Text>);
            }
            segments.push(<Text key={segIdx++} inverse color={theme.yellow}>{coloredLine.substring(idx, idx + searchQuery.length)}</Text>);
            pos = idx + searchQuery.length;
          }
          parts.push(<Text key={`bl-${li}`}>{'  '}{...segments}</Text>);
          return;
        }
      }

      parts.push(
        <Text key={`bl-${li}`}>
          {'  '}
          <Text color={lineColor}>{coloredLine}</Text>
        </Text>
      );
    });

    if (state.bottomSearchActive) {
      parts.push(
        <Text key="search-prompt">
          <Text bold>{'/'}</Text>
          <Text>{state.bottomSearchQuery}</Text>
          <Text bold>{'_'}</Text>
        </Text>
      );
    }
  }

  if (parts.length === 0) return null;

  return <Box flexDirection="column">{parts}</Box>;
}
