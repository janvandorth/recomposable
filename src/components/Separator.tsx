import React from 'react';
import { Text } from 'ink';
import { useTheme } from '../lib/inkTheme.js';

interface SeparatorProps {
  columns: number;
}

export function Separator({ columns }: SeparatorProps): React.ReactElement {
  const theme = useTheme();
  return (
    <Text color={theme.gray}>
      {' ' + '\u2500'.repeat(Math.max(0, columns - 2))}
    </Text>
  );
}
