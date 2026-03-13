import React from 'react';
import { Text, Box } from 'ink';
import { useTheme } from '../lib/inkTheme.js';

export function Logo(): React.ReactElement {
  const theme = useTheme();
  return (
    <Box flexDirection="column">
      <Text bold italic color={theme.logo || undefined}>
        {' \u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u252C\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2510 \u252C  \u250C\u2500\u2510'}
      </Text>
      <Text bold italic color={theme.logo || undefined}>
        {' \u251C\u252C\u2518\u251C\u2524 \u2502  \u2502 \u2502\u2502\u2502\u2502\u251C\u2500\u2518\u2502 \u2502\u2514\u2500\u2510\u251C\u2500\u2524\u251C\u2534\u2510\u2502  \u251C\u2524'}
      </Text>
      <Text bold italic color={theme.logo || undefined}>
        {' \u2534\u2514\u2500\u2514\u2500\u2518\u2514\u2500\u2518\u2514\u2500\u2518\u2534 \u2534\u2534  \u2514\u2500\u2518\u2514\u2500\u2518\u2534 \u2534\u2514\u2500\u2518\u2534\u2500\u2518\u2514\u2500\u2518'}
      </Text>
      <Text color={theme.dim}>{' docker compose manager'}</Text>
    </Box>
  );
}
