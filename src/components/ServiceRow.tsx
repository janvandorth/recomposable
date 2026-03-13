import React from 'react';
import { Text, Box } from 'ink';
import { useTheme } from '../lib/inkTheme.js';
import { statusKey, worktreeLabel } from '../lib/state.js';
import type { AppState, FlatEntry, ContainerStatus, ContainerStats } from '../lib/types.js';

function patternLabel(pattern: string): string {
  return pattern.replace(/^[\[\(\{<]/, '').replace(/[\]\)\}>]$/, '');
}

function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const cleaned = ts.replace(/ [A-Z]{2,5}$/, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

function relativeTimeStr(ts: string | null | undefined): string {
  const date = parseTimestamp(ts);
  if (!date) return '-';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return '-';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatMem(bytes: number): string {
  if (bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

interface ServiceRowProps {
  entry: FlatEntry;
  state: AppState;
  isSelected: boolean;
  isMultiSelected: boolean;
}

export function ServiceRow({ entry, state, isSelected, isMultiSelected }: ServiceRowProps): React.ReactElement {
  const theme = useTheme();
  const sk = statusKey(entry.file, entry.service);
  const st = state.statuses.get(sk);
  const rebuilding = state.rebuilding.has(sk);
  const restarting = state.restarting.has(sk);
  const stopping = state.stopping.has(sk);
  const starting = state.starting.has(sk);
  const isWatching = state.watching.has(sk);
  const isCascading = state.cascading.has(sk);
  const patterns = state.config.logScanPatterns || [];
  const patternColors = [theme.yellow, theme.red, theme.cyan, theme.magenta];

  // Status icon
  let iconChar: string;
  let iconColor: string;
  if (rebuilding || restarting || stopping || starting || isCascading) {
    iconChar = '\u25CF';
    iconColor = theme.yellow;
  } else if (!st) {
    iconChar = '\u25CB';
    iconColor = theme.gray;
  } else if (st.state === 'running') {
    iconChar = '\u25CF';
    iconColor = st.health === 'unhealthy' ? theme.red : theme.green;
  } else if (st.state === 'restarting') {
    iconChar = '\u25CF';
    iconColor = theme.yellow;
  } else {
    iconChar = '\u25CB';
    iconColor = theme.gray;
  }

  // Status text
  const dots = '.'.repeat(state.animDots + 1);
  let statusStr: string;
  let statusColor: string;
  if (stopping) { statusStr = 'STOPPING' + dots; statusColor = theme.yellow; }
  else if (starting) { statusStr = 'STARTING' + dots; statusColor = theme.yellow; }
  else if (restarting) { statusStr = 'RESTARTING' + dots; statusColor = theme.yellow; }
  else if (rebuilding || isCascading) { statusStr = 'REBUILDING' + dots; statusColor = theme.yellow; }
  else if (!st) { statusStr = 'stopped'; statusColor = theme.gray; }
  else {
    statusStr = st.state;
    if (st.health && st.health !== 'none' && st.health !== '') {
      statusStr += ` (${st.health})`;
    }
    if (st.state === 'running') {
      statusColor = st.health === 'unhealthy' ? theme.red : theme.green;
    } else if (st.state === 'exited') {
      statusColor = theme.gray;
    } else if (st.state === 'restarting') {
      statusColor = theme.yellow;
    } else {
      statusColor = theme.dim;
    }
  }

  // CPU/MEM
  const stats: ContainerStats | undefined = state.containerStats?.get(sk);
  let cpuMemStr = '-';
  let cpuMemColor = theme.dim;
  if (stats && st && st.state === 'running') {
    const cpu = stats.cpuPercent;
    const mem = stats.memUsageBytes;
    const cpuWarn = state.config.cpuWarnThreshold || 50;
    const cpuDanger = state.config.cpuDangerThreshold || 100;
    const memWarn = (state.config.memWarnThreshold || 512) * 1024 * 1024;
    const memDanger = (state.config.memDangerThreshold || 1024) * 1024 * 1024;
    if (cpu > cpuDanger || mem > memDanger) cpuMemColor = theme.red;
    else if (cpu > cpuWarn || mem > memWarn) cpuMemColor = theme.yellow;
    cpuMemStr = `${cpu.toFixed(1)}% / ${formatMem(mem)}`;
  }

  // Ports
  let portsStr = '-';
  if (st && st.ports && st.ports.length > 0) {
    portsStr = st.ports.map(p => String(p.published)).join(' ');
  }

  // Built / restarted
  const builtStr = relativeTimeStr(st ? st.createdAt : null);
  const restartedStr = relativeTimeStr(st ? st.startedAt : null);

  // Watch indicator
  const watchChar = isWatching ? 'W' : ' ';

  // Pattern counts
  const logCounts = state.logCounts.get(sk);

  // Worktree
  const wtBranch = st ? st.worktree : null;

  const bgColor = isSelected ? theme.highlightBg : undefined;

  return (
    <Box>
      <Text backgroundColor={bgColor}>
        <Text color={isMultiSelected ? theme.cyan : undefined}>{isMultiSelected ? ' \u2713' : '  '}</Text>
        <Text color={isWatching ? theme.cyan : undefined}>{watchChar}</Text>
        <Text color={iconColor}>{iconChar}</Text>
        <Text>{' '}</Text>
        <Text bold>{entry.service.padEnd(24)}</Text>
        <Text>{' '}</Text>
        <Text color={statusColor}>{statusStr.padEnd(22)}</Text>
        <Text>{' '}</Text>
        <Text color={theme.dim}>{builtStr.padEnd(12)}</Text>
        <Text>{' '}</Text>
        <Text color={theme.dim}>{restartedStr.padEnd(12)}</Text>
        {patterns.map((p, pi) => {
          const key = Array.isArray(p) ? p[0] : p;
          const count = logCounts ? (logCounts.get(key) || 0) : 0;
          const color = count > 0 ? patternColors[pi % patternColors.length] : theme.dim;
          const countText = count > 0 ? String(count) : '-';
          return <Text key={pi} color={color}>{countText.padStart(5)} </Text>;
        })}
        <Text>{'   '}</Text>
        <Text color={cpuMemColor}>{cpuMemStr.padStart(16)}</Text>
        <Text>{' '}</Text>
        <Text color={theme.dim}>{portsStr.padEnd(14)}</Text>
        {state.showWorktreeColumn && (
          <Text color={wtBranch && wtBranch !== 'main' ? theme.yellow : theme.dim}>
            {' ' + worktreeLabel(wtBranch).padEnd(15)}
          </Text>
        )}
      </Text>
    </Box>
  );
}
