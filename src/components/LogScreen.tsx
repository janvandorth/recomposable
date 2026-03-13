import React from 'react';
import { Text, Box } from 'ink';
import { useTheme } from '../lib/inkTheme.js';
import { statusKey } from '../lib/state.js';
import { Logo } from './Logo.js';
import { Separator } from './Separator.js';
import { Legend } from './Legend.js';
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

function wrapPlainLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  const result: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    result.push(line.substring(i, i + width));
  }
  return result;
}

function highlightSearch(text: string, query: string, baseColor: string | null, theme: { yellow: string }): React.ReactElement[] {
  if (!query) return [<Text key="0" color={baseColor || undefined}>{text}</Text>];

  const lowerLine = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const segments: React.ReactElement[] = [];
  let pos = 0;
  let idx = 0;
  while (pos < text.length) {
    const matchIdx = lowerLine.indexOf(lowerQuery, pos);
    if (matchIdx === -1) {
      segments.push(<Text key={idx++} color={baseColor || undefined}>{text.substring(pos)}</Text>);
      break;
    }
    if (matchIdx > pos) {
      segments.push(<Text key={idx++} color={baseColor || undefined}>{text.substring(pos, matchIdx)}</Text>);
    }
    segments.push(<Text key={idx++} inverse color={theme.yellow}>{text.substring(matchIdx, matchIdx + query.length)}</Text>);
    pos = matchIdx + query.length;
  }
  return segments;
}

interface LogScreenProps {
  state: AppState;
  columns: number;
  rows: number;
}

export function LogScreen({ state, columns, rows }: LogScreenProps): React.ReactElement {
  const theme = useTheme();
  const patterns = state.config.logScanPatterns || [];
  const patternColors = [theme.yellow, theme.red, theme.cyan, theme.magenta];
  const entry = state.flatList[state.cursor];
  const serviceName = entry ? entry.service : '???';
  const totalLines = state.logLines.length;

  const hasLogSearch = !!state.logSearchQuery && !state.logSearchActive;

  // Status line
  let statusHeader: React.ReactElement;
  if (state.logBuildKey) {
    const buildInfo = state.bottomLogLines.get(state.logBuildKey);
    const isBuilding = state.rebuilding.has(state.logBuildKey) || state.cascading.has(state.logBuildKey);
    if (buildInfo && buildInfo.action === 'build_failed') {
      statusHeader = <Text><Text color={theme.red}>{' Build failed '}</Text><Text bold>{serviceName}</Text></Text>;
    } else if (isBuilding) {
      statusHeader = <Text><Text color={theme.yellow}>{' Build logs '}</Text><Text bold color={theme.yellow}>{serviceName}</Text></Text>;
    } else {
      statusHeader = <Text><Text color={theme.yellow}>{' Build logs '}</Text><Text bold>{serviceName}</Text></Text>;
    }
  } else {
    const sk = statusKey(entry?.file || '', entry?.service || '');
    const isRestarting = state.restarting.has(sk);
    if (isRestarting) {
      statusHeader = <Text><Text color={theme.yellow}>{' Restarting '}</Text><Text bold color={theme.yellow}>{serviceName}</Text></Text>;
    } else {
      statusHeader = <Text><Text color={theme.green}>{' Run logs '}</Text><Text bold>{serviceName}</Text></Text>;
    }
  }

  let scrollStatus: React.ReactElement;
  if (state.logAutoScroll) {
    scrollStatus = <Text color={theme.green}>{'live'}</Text>;
  } else {
    const currentLine = Math.max(1, totalLines - state.logScrollOffset);
    const pct = totalLines > 0 ? Math.round((currentLine / totalLines) * 100) : 100;
    scrollStatus = <Text><Text color={theme.yellow}>{'paused '}</Text><Text color={theme.dim}>{`line ${currentLine} / ${totalLines} (${pct}%)`}</Text></Text>;
  }

  // Header = logo(4) + sep(1) + legend(1) + status(1) = 7
  const bottomReserved = state.logSearchActive ? 1 : 0;
  const headerHeight = 7;
  const availableRows = Math.max(1, rows - headerHeight - bottomReserved);

  let endLine: number;
  if (state.logAutoScroll || state.logScrollOffset === 0) {
    endLine = totalLines;
  } else {
    endLine = Math.max(Math.min(availableRows, totalLines), totalLines - state.logScrollOffset);
  }

  const searchQuery = state.logSearchQuery || '';
  const matchSet = searchQuery ? new Set(state.logSearchMatches) : null;

  // Build display lines by wrapping
  const displayLines: Array<{ text: string; isMatch: boolean; lineColor: string | null }> = [];
  for (let i = endLine - 1; i >= 0 && displayLines.length < availableRows; i--) {
    const line = state.logLines[i];
    const wrapped = wrapPlainLine(line, columns);
    const isMatch = matchSet ? matchSet.has(i) : false;
    const lineColor = logLineColor(line, patterns, patternColors);
    for (let w = wrapped.length - 1; w >= 0; w--) {
      displayLines.push({ text: wrapped[w], isMatch, lineColor });
    }
  }
  displayLines.reverse();
  const trimmed = displayLines.length > availableRows
    ? displayLines.slice(displayLines.length - availableRows)
    : displayLines;

  const paddingNeeded = Math.max(0, rows - headerHeight - trimmed.length - bottomReserved);

  return (
    <Box flexDirection="column">
      <Logo />
      <Separator columns={columns} />
      <Legend logsScrollMode={true} hasLogSearch={hasLogSearch} />
      <Text>
        {statusHeader}
        {'  '}
        {scrollStatus}
        {(state.logSearchPending || state.logHistoryLoading) && (
          <Text color={theme.yellow}>{'  loading history...'}</Text>
        )}
        {!state.logSearchPending && !state.logHistoryLoading && searchQuery && state.logSearchMatches.length > 0 && (
          <Text color={theme.dim}>{'  match ' + (state.logSearchMatchIdx + 1) + '/' + state.logSearchMatches.length}</Text>
        )}
        {!state.logSearchPending && !state.logHistoryLoading && searchQuery && state.logSearchMatches.length === 0 && (
          <Text color={theme.red}>{'  no matches'}</Text>
        )}
      </Text>

      {totalLines === 0 && <Text color={theme.dim}>{'  loading...'}</Text>}

      {trimmed.map((dl, i) => {
        if (dl.isMatch && searchQuery) {
          return <Text key={i}>{...highlightSearch(dl.text, searchQuery, dl.lineColor, theme)}</Text>;
        }
        if (dl.lineColor) {
          return <Text key={i} color={dl.lineColor}>{dl.text}</Text>;
        }
        return <Text key={i}>{dl.text}</Text>;
      })}

      {paddingNeeded > 0 && Array.from({ length: paddingNeeded }, (_, i) => (
        <Text key={`pad-${i}`}>{''}</Text>
      ))}

      {state.logSearchActive && (
        <Text>
          <Text bold>{'/'}</Text>
          <Text>{state.logSearchQuery}</Text>
          <Text bold>{'_'}</Text>
        </Text>
      )}
    </Box>
  );
}
