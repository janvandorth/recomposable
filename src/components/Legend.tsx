import React from 'react';
import { Text, Box } from 'ink';
import { useTheme } from '../lib/inkTheme.js';
import type { LegendOptions } from '../lib/types.js';

function LegendItem({ text, active }: { text: string; active: boolean }): React.ReactElement {
  const theme = useTheme();
  if (active) {
    return <Text inverse>{' ' + text + ' '}</Text>;
  }
  return <Text color={theme.dim}>{text}</Text>;
}

export function Legend(opts: LegendOptions): React.ReactElement {
  const {
    logPanelActive = false,
    logsScrollMode = false,
    noCacheActive = false,
    noDepsActive = false,
    watchActive = false,
    execMode = false,
    execInline = false,
    worktreePickerActive = false,
  } = opts;

  let items: Array<{ text: string; active: boolean }>;

  if (opts.multiSelectActive) {
    items = [
      { text: '[v] toggle', active: false },
      { text: '[Esc] discard', active: false },
      { text: 'Re[B]uild all', active: false },
      { text: '[S]tart all', active: false },
      { text: 'Sto[P] all', active: false },
      { text: 'Switch [t]ree all', active: false },
      { text: '[Q]uit', active: false },
    ];
  } else if (worktreePickerActive) {
    items = [
      { text: '[Esc] cancel', active: false },
      { text: '[Enter] switch', active: false },
      { text: '[j/k] navigate', active: false },
    ];
  } else if (execMode) {
    items = [
      { text: '[Esc] back', active: false },
      { text: '[Enter] run', active: false },
      { text: '[Up/Down] history', active: false },
      { text: '[Ctrl+C] kill', active: false },
      { text: '[Ctrl+Q] quit', active: false },
    ];
  } else if (execInline) {
    items = [
      { text: '[Esc] back', active: false },
      { text: '[Enter] run', active: false },
      { text: '[Up/Down] history', active: false },
      { text: '[Ctrl+C] kill', active: false },
      { text: '[Ctrl+F] full screen', active: false },
      { text: '[Ctrl+Q] quit', active: false },
    ];
  } else if (logsScrollMode) {
    const hasSearch = opts.hasLogSearch || false;
    items = [
      { text: hasSearch ? '[Esc] clear search' : '[Esc] back', active: false },
      { text: '[j/k] scroll', active: false },
      { text: '[G] bottom', active: false },
      { text: '[gg] top', active: false },
      { text: '[/] search', active: false },
      { text: '[n/N] next/prev', active: false },
      { text: '[Q]uit', active: false },
    ];
  } else {
    const { buildingActive = false, startingActive = false } = opts;
    items = [
      { text: buildingActive ? 'Stop [B]uild' : 'Re[B]uild', active: buildingActive },
      { text: '[D]ep rebuild', active: false },
      { text: startingActive ? 'Stop [S]tart' : 'Re[S]tart', active: startingActive },
      { text: 'Sto[P]', active: false },
      { text: '[W]atch', active: watchActive },
      { text: '[N]o cache', active: noCacheActive },
      { text: 'n[O] deps', active: noDepsActive },
      { text: '[e]xec', active: false },
      { text: '[F]ull [L]ogs', active: logPanelActive },
      { text: '[v] select', active: false },
      { text: 'Switch [t]ree', active: false },
      { text: '[Q]uit', active: false },
    ];
    const customActions = opts.customActions || [];
    for (const action of customActions) {
      items.push({ text: `[${action.key}] ${action.label}`, active: false });
    }
  }

  return (
    <Box>
      <Text>{' '}</Text>
      {items.map((item, i) => (
        <Box key={i}>
          <LegendItem text={item.text} active={item.active} />
          {i < items.length - 1 && <Text>{'  '}</Text>}
        </Box>
      ))}
    </Box>
  );
}
