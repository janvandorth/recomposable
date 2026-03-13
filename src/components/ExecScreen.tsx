import React from 'react';
import { Text, Box } from 'ink';
import { useTheme } from '../lib/inkTheme.js';
import { Logo } from './Logo.js';
import { Separator } from './Separator.js';
import { Legend } from './Legend.js';
import type { AppState } from '../lib/types.js';

interface ExecScreenProps {
  state: AppState;
  columns: number;
  rows: number;
}

export function ExecScreen({ state, columns, rows }: ExecScreenProps): React.ReactElement {
  const theme = useTheme();
  const serviceName = state.execService || '???';
  const runningIndicator = state.execChild ? 'running' : 'ready';
  const runningColor = state.execChild ? theme.yellow : theme.green;

  // Header = logo(4) + sep(1) + legend(1) + status(1) = 7
  const headerHeight = 7;
  const availableRows = Math.max(1, rows - headerHeight - 1); // -1 for prompt

  const totalLines = state.execOutputLines.length;
  const startLine = Math.max(0, totalLines - availableRows);
  const visibleLines = state.execOutputLines.slice(startLine);

  const paddingNeeded = Math.max(0, rows - headerHeight - visibleLines.length - 1);

  return (
    <Box flexDirection="column">
      <Logo />
      <Separator columns={columns} />
      <Legend execMode={true} />
      <Text>
        <Text color={theme.cyan}>{' exec '}</Text>
        <Text bold>{serviceName}</Text>
        <Text>{'  '}</Text>
        <Text color={runningColor}>{runningIndicator}</Text>
        {state.execCwd && <Text color={theme.dim}>{'  ' + state.execCwd}</Text>}
      </Text>

      {visibleLines.map((line, i) => (
        <Text key={i}>{'  ' + line.substring(0, columns - 4)}</Text>
      ))}

      {paddingNeeded > 0 && Array.from({ length: paddingNeeded }, (_, i) => (
        <Text key={`pad-${i}`}>{''}</Text>
      ))}

      <Text>
        <Text color={theme.green}>{'$ '}</Text>
        <Text>{state.execInput}</Text>
        <Text bold>{'_'}</Text>
      </Text>
    </Box>
  );
}
