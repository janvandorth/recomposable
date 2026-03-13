import React, { useMemo } from 'react';
import { Text, Box } from 'ink';
import { useTheme } from '../lib/inkTheme.js';
import { statusKey } from '../lib/state.js';
import { Logo } from './Logo.js';
import { Separator } from './Separator.js';
import { Legend } from './Legend.js';
import { ServiceRow } from './ServiceRow.js';
import { BottomPanel } from './BottomPanel.js';
import type { AppState } from '../lib/types.js';

function patternLabel(pattern: string): string {
  return pattern.replace(/^[\[\(\{<]/, '').replace(/[\]\)\}>]$/, '');
}

interface ListScreenProps {
  state: AppState;
  columns: number;
  rows: number;
}

export function ListScreen({ state, columns, rows }: ListScreenProps): React.ReactElement {
  const theme = useTheme();
  const patterns = state.config.logScanPatterns || [];

  const watchActive = state.watching.size > 0;
  const selEntry = state.flatList[state.cursor];
  const selSk = selEntry ? statusKey(selEntry.file, selEntry.service) : '';
  const buildingActive = !!selSk && (state.rebuilding.has(selSk) || state.cascading.has(selSk));
  const startingActive = !!selSk && (state.starting.has(selSk) || state.restarting.has(selSk));

  // Build stubs for virtual scrolling
  const stubs = useMemo(() => {
    const result: Array<{ type: 'blank' | 'header' | 'service'; flatIdx: number; groupIdx: number }> = [];
    let currentGroup = -1;
    for (let i = 0; i < state.flatList.length; i++) {
      const entry = state.flatList[i];
      if (entry.groupIdx !== currentGroup) {
        currentGroup = entry.groupIdx;
        if (result.length > 0) result.push({ type: 'blank', flatIdx: -1, groupIdx: entry.groupIdx });
        result.push({ type: 'header', flatIdx: -1, groupIdx: entry.groupIdx });
      }
      result.push({ type: 'service', flatIdx: i, groupIdx: entry.groupIdx });
    }
    return result;
  }, [state.flatList, state.groups]);

  // Logo (4) + sep (1) + legend (1) + col header (1) = 7
  const headerHeight = 7;

  // Service list gets exactly enough rows for all stubs (no more)
  const serviceRows = Math.min(stubs.length, Math.max(3, rows - headerHeight - 2));
  // Bottom panel fills remaining space
  const bottomAvailableRows = Math.max(0, rows - headerHeight - serviceRows);

  const availableRows = serviceRows;

  // Virtual scrolling
  const cursorStubIdx = stubs.findIndex(s => s.type === 'service' && s.flatIdx === state.cursor);
  let scrollOffset = state.scrollOffset;
  if (cursorStubIdx < scrollOffset) {
    scrollOffset = cursorStubIdx;
  } else if (cursorStubIdx >= scrollOffset + availableRows) {
    scrollOffset = cursorStubIdx - availableRows + 1;
  }
  scrollOffset = Math.max(0, Math.min(stubs.length - availableRows, scrollOffset));
  // Sync back to state (side effect, but necessary for consistency)
  if (state.scrollOffset !== scrollOffset) {
    state.scrollOffset = scrollOffset;
  }

  const visEnd = Math.min(stubs.length, scrollOffset + availableRows);
  const visibleStubs = stubs.slice(scrollOffset, visEnd);

  // Column header
  let colHeader = '     ' + 'SERVICE'.padEnd(24) + ' ';
  colHeader += 'STATUS'.padEnd(22) + ' ' + 'BUILT'.padEnd(12) + ' ' + 'RESTARTED'.padEnd(12);
  for (const p of patterns) colHeader += patternLabel(Array.isArray(p) ? p[0] : p).padStart(5) + ' ';
  colHeader += '   ' + 'CPU/MEM'.padStart(16) + ' ' + 'PORTS'.padEnd(14);
  if (state.showWorktreeColumn) colHeader += ' ' + 'WORKTREE'.padEnd(15);

  // No padding — bottom panel fills remaining space

  return (
    <Box flexDirection="column">
      <Logo />
      <Separator columns={columns} />
      <Legend
        logPanelActive={state.execActive ? undefined : state.worktreePickerActive ? undefined : state.showBottomLogs}
        execInline={state.execActive || undefined}
        worktreePickerActive={state.worktreePickerActive || undefined}
        noCacheActive={state.noCache}
        noDepsActive={state.noDeps}
        watchActive={watchActive}
        buildingActive={buildingActive}
        startingActive={startingActive}
        customActions={state.config.customActions}
        multiSelectActive={state.multiSelected.size > 0}
      />
      <Text color={theme.dim}>{colHeader}</Text>

      {visibleStubs.map((stub, idx) => {
        switch (stub.type) {
          case 'blank':
            return <Text key={`b-${idx}`}>{''}</Text>;
          case 'header': {
            const group = state.groups[stub.groupIdx];
            return (
              <Text key={`h-${idx}`}>
                <Text bold>{' ' + group.label}</Text>
                {group.error && <Text color={theme.red}>{`  (${group.error})`}</Text>}
              </Text>
            );
          }
          case 'service':
            return (
              <ServiceRow
                key={`s-${stub.flatIdx}`}
                entry={state.flatList[stub.flatIdx]}
                state={state}
                isSelected={stub.flatIdx === state.cursor}
                isMultiSelected={state.multiSelected.has(statusKey(state.flatList[stub.flatIdx].file, state.flatList[stub.flatIdx].service))}
              />
            );
          default:
            return null;
        }
      })}

      <BottomPanel state={state} columns={columns} availableRows={bottomAvailableRows} />
    </Box>
  );
}
