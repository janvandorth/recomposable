import { statusKey, MODE, worktreeLabel } from './state.js';
import { getActivePalette } from './theme.js';
import type { AppState, LegendOptions, DisplayLine } from './types.js';

const ESC = '\x1b[';

export function visLen(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

export function padVisible(str: string, width: number): string {
  const pad = Math.max(0, width - visLen(str));
  return str + ' '.repeat(pad);
}

export function padVisibleStart(str: string, width: number): string {
  const pad = Math.max(0, width - visLen(str));
  return ' '.repeat(pad) + str;
}

export const CLEAR_EOL = `${ESC}K`;
export const CLEAR_EOS = `${ESC}J`;

function patternColors(): string[] {
  const p = getActivePalette();
  return [p.yellow, p.red, p.cyan, p.magenta];
}

function logLineColor(line: string, patterns: (string | string[])[]): string | null {
  const colors = patternColors();
  let color: string | null = null;
  for (let pi = 0; pi < patterns.length; pi++) {
    const group = Array.isArray(patterns[pi]) ? patterns[pi] as string[] : [patterns[pi] as string];
    if (group.some(p => line.includes(p))) {
      color = colors[pi % colors.length];
    }
  }
  return color;
}

// Cached separator line — recomputed only when terminal width changes
let cachedSepColumns = 0;
let cachedSepLine = '';
let cachedSepGray = '';

function patternLabel(pattern: string): string {
  return pattern.replace(/^[\[\(\{<]/, '').replace(/[\]\)\}>]$/, '');
}

function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const cleaned = ts.replace(/ [A-Z]{2,5}$/, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

export function relativeTime(ts: string | null | undefined): string {
  const { gray, dim, reset } = getActivePalette();
  const date = parseTimestamp(ts);
  if (!date) return `${gray}-${reset}`;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return `${gray}-${reset}`;
  if (seconds < 60) return `${dim}${seconds}s ago${reset}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${dim}${minutes}m ago${reset}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${dim}${hours}h ago${reset}`;
  const days = Math.floor(hours / 24);
  return `${dim}${days}d ago${reset}`;
}

export function clearScreen(): string {
  return `${ESC}H${ESC}?25l`;
}

function separatorLine(columns: number): string {
  const { gray, reset } = getActivePalette();
  if (columns !== cachedSepColumns || gray !== cachedSepGray) {
    cachedSepColumns = columns;
    cachedSepGray = gray;
    cachedSepLine = ` ${gray}${'\u2500'.repeat(Math.max(0, columns - 2))}${reset}`;
  }
  return cachedSepLine;
}

export function showCursor(): string {
  return `${ESC}?25h`;
}

export function statusIcon(status: { state: string; health: string } | null | undefined, isRebuilding: boolean, isRestarting: boolean, isStopping: boolean, isStarting: boolean): string {
  const { yellow, gray, red, green, reset } = getActivePalette();
  if (isRebuilding || isRestarting || isStopping || isStarting) return `${yellow}\u25CF${reset}`;
  if (!status) return `${gray}\u25CB${reset}`;

  const { state, health } = status;
  if (state === 'running') {
    if (health === 'unhealthy') return `${red}\u25CF${reset}`;
    return `${green}\u25CF${reset}`;
  }
  if (state === 'restarting') return `${yellow}\u25CF${reset}`;
  return `${gray}\u25CB${reset}`;
}

export function statusText(status: { state: string; health: string } | null | undefined, isRebuilding: boolean, isRestarting: boolean, isStopping: boolean, isStarting: boolean): string {
  const { yellow, gray, red, green, dim, reset } = getActivePalette();
  if (isStopping) return `${yellow}STOPPING...${reset}`;
  if (isStarting) return `${yellow}STARTING...${reset}`;
  if (isRestarting) return `${yellow}RESTARTING...${reset}`;
  if (isRebuilding) return `${yellow}REBUILDING...${reset}`;
  if (!status) return `${gray}stopped${reset}`;

  const { state, health } = status;
  let text = state;
  if (health && health !== 'none' && health !== '') {
    text += ` (${health})`;
  }

  if (state === 'running') {
    if (health === 'unhealthy') return `${red}${text}${reset}`;
    return `${green}${text}${reset}`;
  }
  if (state === 'exited') return `${gray}${text}${reset}`;
  if (state === 'restarting') return `${yellow}${text}${reset}`;
  return `${dim}${text}${reset}`;
}

export function formatMem(bytes: number): string {
  if (bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function renderLogo(): string[] {
  const { italic, bold, dim, reset, logo } = getActivePalette();
  const color = logo || '';
  return [
    ` ${color}${italic}${bold}\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u252C\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2510 \u252C  \u250C\u2500\u2510${reset}`,
    ` ${color}${italic}${bold}\u251C\u252C\u2518\u251C\u2524 \u2502  \u2502 \u2502\u2502\u2502\u2502\u251C\u2500\u2518\u2502 \u2502\u2514\u2500\u2510\u251C\u2500\u2524\u251C\u2534\u2510\u2502  \u251C\u2524${reset}`,
    ` ${color}${italic}${bold}\u2534\u2514\u2500\u2514\u2500\u2518\u2514\u2500\u2518\u2514\u2500\u2518\u2534 \u2534\u2534  \u2514\u2500\u2518\u2514\u2500\u2518\u2534 \u2534\u2514\u2500\u2518\u2534\u2500\u2518\u2514\u2500\u2518${reset}`,
    ` ${dim}docker compose manager${reset}`,
  ];
}

export function renderLegend(opts: LegendOptions = {}): string {
  const { reverse, dim, reset } = getActivePalette();
  const { logPanelActive = false, logsScrollMode = false, noCacheActive = false, noDepsActive = false, watchActive = false, execMode = false, execInline = false, worktreePickerActive = false } = opts;
  const item = (text: string, active: boolean): string => {
    if (active) return `${reverse} ${text} ${reset}`;
    return `${dim}${text}${reset}`;
  };
  if (worktreePickerActive) {
    return [
      item('[Esc] cancel', false),
      item('[Enter] switch', false),
      item('[j/k] navigate', false),
    ].join('  ');
  }
  if (execMode) {
    return [
      item('[Esc] back', false),
      item('[Enter] run', false),
      item('[Up/Down] history', false),
      item('[Ctrl+C] kill', false),
      item('[Ctrl+Q] quit', false),
    ].join('  ');
  }
  if (execInline) {
    return [
      item('[Esc] back', false),
      item('[Enter] run', false),
      item('[Up/Down] history', false),
      item('[Ctrl+C] kill', false),
      item('[Ctrl+F] full screen', false),
      item('[Ctrl+Q] quit', false),
    ].join('  ');
  }
  if (logsScrollMode) {
    const hasSearch = opts.hasLogSearch || false;
    return [
      item(hasSearch ? '[Esc] clear search' : '[Esc] back', false),
      item('[j/k] scroll', false),
      item('[G] bottom', false),
      item('[gg] top', false),
      item('[/] search', false),
      item('[n/N] next/prev', false),
      item('[Q]uit', false),
    ].join('  ');
  }
  if (opts.multiSelectActive) {
    return [
      item('[v] toggle', false),
      item('[Esc] discard', false),
      item('Re[B]uild all', false),
      item('[S]tart all', false),
      item('Sto[P] all', false),
      item('Switch [t]ree all', false),
      item('[Q]uit', false),
    ].join('  ');
  }
  const { buildingActive = false, startingActive = false } = opts;
  const items = [
    item(buildingActive ? 'Stop [B]uild' : 'Re[B]uild', buildingActive),
    item('[D]ep rebuild', false),
    item(startingActive ? 'Stop [S]tart' : 'Re[S]tart', startingActive),
    item('Sto[P]', false),
    item('[W]atch', watchActive),
    item('[N]o cache', noCacheActive),
    item('n[O] deps', noDepsActive),
    item('[e]xec', false),
    item('[F]ull [L]ogs', logPanelActive),
    item('[v] select', false),
    item('Switch [t]ree', false),
    item('[Q]uit', false),
  ];
  const customActions = opts.customActions || [];
  for (const action of customActions) {
    items.push(item(`[${action.key}] ${action.label}`, false));
  }
  return items.join('  ');
}

export function renderListView(state: AppState): string {
  const { reset, bold, dim, reverse, green, yellow, red, gray, cyan, magenta } = getActivePalette();
  const columns = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const patterns = state.config.logScanPatterns || [];
  const pColors = patternColors();
  const sep = separatorLine(columns);
  const buf: string[] = [];

  for (const line of renderLogo()) {
    buf.push(line);
  }
  const watchActive = state.watching.size > 0;
  const selEntry = state.flatList[state.cursor];
  const selSk = selEntry ? statusKey(selEntry.file, selEntry.service) : '';
  const buildingActive = !!selSk && (state.rebuilding.has(selSk) || state.cascading.has(selSk));
  const startingActive = !!selSk && (state.starting.has(selSk) || state.restarting.has(selSk));
  const isMulti = state.multiSelected.size > 0;
  const help = state.execActive
    ? renderLegend({ execInline: true })
    : state.worktreePickerActive
    ? renderLegend({ worktreePickerActive: true })
    : isMulti
    ? renderLegend({ multiSelectActive: true })
    : renderLegend({ logPanelActive: state.showBottomLogs, noCacheActive: state.noCache, noDepsActive: state.noDeps, watchActive, buildingActive, startingActive, customActions: state.config.customActions });
  buf.push(sep);
  buf.push(` ${help}`);

  // Single column header row (not repeated per group)
  let colHeader = `${dim}     ${'SERVICE'.padEnd(24)} `;
  colHeader += `${'STATUS'.padEnd(22)} ${'BUILT'.padEnd(12)} ${'RESTARTED'.padEnd(12)}`;
  for (const p of patterns) colHeader += patternLabel(Array.isArray(p) ? p[0] : p).padStart(5) + ' ';
  colHeader += `   ${'CPU/MEM'.padStart(16)} ${'PORTS'.padEnd(14)}`;
  if (state.showWorktreeColumn) colHeader += ` ${'WORKTREE'.padEnd(15)}`;
  buf.push(colHeader + reset);

  const headerHeight = buf.length;

  const bottomBuf: string[] = [];
  if (isMulti) {
    bottomBuf.push(sep);
    bottomBuf.push(` ${cyan}Selection${reset} ${dim}- press Esc to discard${reset}`);
    for (const mSk of state.multiSelected) {
      const mEntry = state.flatList.find(e => statusKey(e.file, e.service) === mSk);
      if (mEntry) {
        bottomBuf.push(`  ${cyan}\u2713${reset} ${bold}${mEntry.service}${reset}`);
      }
    }
    // If worktree picker is also active during multiselect, show both
    if (state.worktreePickerActive) {
      bottomBuf.push(sep);
      bottomBuf.push(` ${cyan}switch worktree ${bold}selected services${reset}`);
      bottomBuf.push(`  ${dim}j/k navigate  Enter confirm  Esc cancel${reset}`);
      for (let wi = 0; wi < state.worktreePickerEntries.length; wi++) {
        const wt = state.worktreePickerEntries[wi];
        const isSelected = wi === state.worktreePickerCursor;
        const prefix = isSelected ? `${reverse}` : '';
        const suffix = isSelected ? `${reset}` : '';
        const currentTag = (state.worktreePickerCurrentPath && state.worktreePickerCurrentPath === wt.path)
          ? ` ${dim}(current)${reset}` : '';
        bottomBuf.push(`  ${prefix}  ${wt.branch}  ${dim}${wt.path}${reset}${currentTag}${suffix}`);
      }
    }
  } else if (state.worktreePickerActive) {
    const selEntry = state.flatList[state.cursor];
    if (selEntry) {
      bottomBuf.push(sep);
      bottomBuf.push(` ${cyan}switch worktree ${bold}${selEntry.service}${reset}`);
      bottomBuf.push(`  ${dim}j/k navigate  Enter confirm  Esc cancel${reset}`);
      for (let wi = 0; wi < state.worktreePickerEntries.length; wi++) {
        const wt = state.worktreePickerEntries[wi];
        const isSelected = wi === state.worktreePickerCursor;
        const prefix = isSelected ? `${reverse}` : '';
        const suffix = isSelected ? `${reset}` : '';
        const currentTag = (state.worktreePickerCurrentPath && state.worktreePickerCurrentPath === wt.path)
          ? ` ${dim}(current)${reset}` : '';
        bottomBuf.push(`  ${prefix}  ${wt.branch}  ${dim}${wt.path}${reset}${currentTag}${suffix}`);
      }
    }
  } else if (state.execActive && state.execService) {
    bottomBuf.push(sep);
    const runningIndicator = state.execChild ? `${yellow}running${reset}` : `${green}ready${reset}`;
    const cwdInfo = state.execCwd ? `  ${dim}${state.execCwd}${reset}` : '';
    bottomBuf.push(` ${cyan}exec ${bold}${state.execService}${reset}  ${runningIndicator}${cwdInfo}`);
    const maxOutputLines = Math.max(1, (state.config.bottomLogCount || 10) - 1);
    const outputStart = Math.max(0, state.execOutputLines.length - maxOutputLines);
    for (let i = outputStart; i < state.execOutputLines.length; i++) {
      bottomBuf.push(truncateLine(`  ${state.execOutputLines[i]}`, columns));
    }
    bottomBuf.push(`${green}$ ${reset}${state.execInput}${bold}_${reset}`);
  } else if (state.showBottomLogs) {
    const selEntry = state.flatList[state.cursor];
    if (selEntry) {
      const sk = statusKey(selEntry.file, selEntry.service);

      // Check for cascade progress
      const cascade = state.cascading.get(sk);
      if (cascade) {
        bottomBuf.push(sep);
        bottomBuf.push(` ${yellow}cascading ${bold}${selEntry.service}${reset}`);
        for (let si = 0; si < cascade.steps.length; si++) {
          const step = cascade.steps[si];
          let marker: string;
          switch (step.status) {
            case 'completed': marker = `${green}[done]${reset}`; break;
            case 'in_progress': marker = `${yellow}[>>> ]${reset}`; break;
            case 'failed': marker = `${red}[FAIL]${reset}`; break;
            default: marker = `${dim}[    ]${reset}`;
          }
          bottomBuf.push(`  ${marker} ${step.action} ${bold}${step.service}${reset}`);
        }
      }

      const info = state.bottomLogLines.get(sk);
      if (info) {
        if (!cascade) {
          bottomBuf.push(sep);
        }
        const isFailed = info.action === 'build_failed' || info.action === 'restart_failed' || info.action === 'stop_failed' || info.action === 'start_failed' || info.action === 'switch_failed';
        const actionColor = isFailed ? red
          : info.action === 'rebuilding' || info.action === 'restarting' || info.action === 'stopping' || info.action === 'starting' || info.action === 'cascading' || info.action === 'switching' ? yellow
          : info.action === 'watching' ? cyan : green;
        let actionLabel: string;
        if (isFailed) actionLabel = info.action.replace('_', ' ').toUpperCase();
        else if (info.action === 'rebuilding') actionLabel = 'Build logs';
        else if (info.action === 'restarting') actionLabel = 'Restarting';
        else if (info.action === 'switching') actionLabel = 'Switching';
        else if (info.action === 'logs' || info.action === 'started') actionLabel = 'Run logs';
        else actionLabel = info.action;
        let headerLine = ` ${actionColor}${actionLabel} ${bold}${info.service}${reset}`;
        const bq = state.bottomSearchQuery || '';
        if (bq && !state.bottomSearchActive) {
          if (state.bottomSearchLoading) {
            headerLine += `  ${yellow}searching "${bq}"...${reset}`;
          } else {
            const totalMatches = state.bottomSearchTotalMatches;
            headerLine += totalMatches > 0
              ? `  ${dim}search: "${bq}" (${totalMatches} match${totalMatches !== 1 ? 'es' : ''} in full log)${reset}`
              : `  ${red}search: "${bq}" (no matches)${reset}`;
          }
        }
        bottomBuf.push(headerLine);

        if (info.lines.length === 0 && info.action === 'logs') {
          bottomBuf.push(`  ${dim}loading...${reset}`);
        }

        const searchQuery = bq && !state.bottomSearchActive ? bq : '';
        const maxBottomLines = state.config.bottomLogCount || 10;
        const visibleLines = info.lines.slice(-maxBottomLines);

        for (const line of visibleLines) {
          let coloredLine = line.substring(0, columns - 4);
          const lineColor = logLineColor(coloredLine, patterns) || dim;
          if (searchQuery) {
            const lowerLine = coloredLine.toLowerCase();
            const lowerQ = searchQuery.toLowerCase();
            if (lowerLine.includes(lowerQ)) {
              let result = '';
              let pos = 0;
              while (pos < coloredLine.length) {
                const idx = lowerLine.indexOf(lowerQ, pos);
                if (idx === -1) { result += coloredLine.substring(pos); break; }
                result += coloredLine.substring(pos, idx);
                result += `${reverse}${yellow}${coloredLine.substring(idx, idx + searchQuery.length)}${reset}${lineColor}`;
                pos = idx + searchQuery.length;
              }
              coloredLine = result;
            }
          }
          bottomBuf.push(`  ${lineColor}${coloredLine}${reset}`);
        }

        if (state.bottomSearchActive) {
          bottomBuf.push(`${bold}/${reset}${state.bottomSearchQuery}${bold}_${reset}`);
        }
      }
    }
  }
  const bottomHeight = bottomBuf.length;

  // Pass 1: build lightweight stubs (type + index only, no text computation)
  const stubs: Array<{ type: 'blank' | 'header' | 'service'; flatIdx: number; groupIdx: number }> = [];
  let currentGroup = -1;

  for (let i = 0; i < state.flatList.length; i++) {
    const entry = state.flatList[i];

    if (entry.groupIdx !== currentGroup) {
      currentGroup = entry.groupIdx;
      if (stubs.length > 0) stubs.push({ type: 'blank', flatIdx: -1, groupIdx: entry.groupIdx });
      stubs.push({ type: 'header', flatIdx: -1, groupIdx: entry.groupIdx });
    }

    stubs.push({ type: 'service', flatIdx: i, groupIdx: entry.groupIdx });
  }

  const availableRows = Math.max(3, rows - headerHeight - bottomHeight);

  // Find cursor position in stubs
  const cursorStubIdx = stubs.findIndex(s => s.type === 'service' && s.flatIdx === state.cursor);

  if (cursorStubIdx < state.scrollOffset) {
    state.scrollOffset = cursorStubIdx;
  } else if (cursorStubIdx >= state.scrollOffset + availableRows) {
    state.scrollOffset = cursorStubIdx - availableRows + 1;
  }
  state.scrollOffset = Math.max(0, Math.min(stubs.length - availableRows, state.scrollOffset));

  // Pass 2: render text only for visible stubs
  const visEnd = Math.min(stubs.length, state.scrollOffset + availableRows);
  for (let si = state.scrollOffset; si < visEnd; si++) {
    const stub = stubs[si];
    switch (stub.type) {
      case 'blank':
        buf.push('');
        break;
      case 'header': {
        const group = state.groups[stub.groupIdx];
        const label = ` ${bold}${group.label}${reset}`;
        buf.push(group.error ? `${label}  ${red}(${group.error})${reset}` : label);
        break;
      }
      case 'service': {
        const i = stub.flatIdx;
        const entry = state.flatList[i];
        const sk = statusKey(entry.file, entry.service);
        const st = state.statuses.get(sk);
        const rebuilding = state.rebuilding.has(sk);
        const restarting = state.restarting.has(sk);
        const stopping = state.stopping.has(sk);
        const starting = state.starting.has(sk);
        const isWatching = state.watching.has(sk);
        const isCascading = state.cascading.has(sk);
        const icon = statusIcon(st, rebuilding || isCascading, restarting, stopping, starting);
        const stext = statusText(st, rebuilding || isCascading, restarting, stopping, starting);
        const watchIndicator = isWatching ? `${cyan}W${reset}` : ' ';
        const wtBranch = st ? st.worktree : null;
        const name = entry.service.padEnd(24);
        const statusPadded = padVisible(stext, 22);

        let cpuMemStr: string;
        const stats = state.containerStats ? state.containerStats.get(sk) : null;
        if (stats && st && st.state === 'running') {
          const cpu = stats.cpuPercent;
          const mem = stats.memUsageBytes;
          const cpuWarn = state.config.cpuWarnThreshold || 50;
          const cpuDanger = state.config.cpuDangerThreshold || 100;
          const memWarn = (state.config.memWarnThreshold || 512) * 1024 * 1024;
          const memDanger = (state.config.memDangerThreshold || 1024) * 1024 * 1024;
          let color = dim;
          if (cpu > cpuDanger || mem > memDanger) color = red;
          else if (cpu > cpuWarn || mem > memWarn) color = yellow;
          const cpuText = cpu.toFixed(1) + '%';
          const memText = formatMem(mem);
          cpuMemStr = padVisible(`${color}${cpuText} / ${memText}${reset}`, 16);
        } else {
          cpuMemStr = padVisible(`${dim}-${reset}`, 16);
        }

        let portsStr: string;
        if (st && st.ports && st.ports.length > 0) {
          const portsText = st.ports.map(p => p.published).join(' ');
          portsStr = padVisible(`${dim}${portsText}${reset}`, 14);
        } else {
          portsStr = padVisible(`${dim}-${reset}`, 14);
        }

        const built = padVisible(relativeTime(st ? st.createdAt : null), 12);
        const restarted = padVisible(relativeTime(st ? st.startedAt : null), 12);
        const isSelected = i === state.cursor;

        let countsStr = '';
        const logCounts = state.logCounts.get(sk);
        for (let pi = 0; pi < patterns.length; pi++) {
          const key = Array.isArray(patterns[pi]) ? (patterns[pi] as string[])[0] : patterns[pi] as string;
          const count = logCounts ? (logCounts.get(key) || 0) : 0;
          const color = count > 0 ? pColors[pi % pColors.length] : dim;
          const countText = count > 0 ? `${color}${count}${reset}` : `${color}-${reset}`;
          countsStr += padVisibleStart(countText, 5) + ' ';
        }

        let worktreeCol = '';
        if (state.showWorktreeColumn) {
          const wtLabel = worktreeLabel(st ? st.worktree : null);
          const wtColor = (wtBranch && wtBranch !== 'main') ? yellow : dim;
          worktreeCol = ` ${wtColor}${wtLabel.padEnd(15)}${reset}`;
        }

        const multiMark = state.multiSelected.has(sk) ? `${cyan} \u2713${reset}` : '  ';
        let row = `${multiMark}${watchIndicator}${icon} ${bold}${name}${reset} ${statusPadded} ${built} ${restarted}${countsStr}  ${cpuMemStr} ${portsStr}${worktreeCol}`;
        if (isSelected) {
          const { highlightBg, dim: dimCode } = getActivePalette();
          // Use explicit bg color for highlight bar so colored text stays readable;
          // strip dim/gray so text pops on the highlight bg; make fg colors bold
          const dimEsc = dimCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          row = row.replace(/\x1b\[2m/g, '').replace(/\x1b\[90m/g, '').replace(new RegExp(dimEsc, 'g'), '');
          row = row.replace(/\x1b\[1;3([1-6])m/g, '\x1b[1;3$1m');
          row = row.replace(/\x1b\[3([1-6])m/g, '\x1b[1;3$1m');
          row = `${highlightBg}${bold}${row.replace(/\x1b\[0m/g, `${reset}${highlightBg}${bold}`)}${' '.repeat(Math.max(0, columns - visLen(row)))}${reset}`;
        }
        buf.push(row);
        break;
      }
    }
  }

  const usedLines = buf.length + bottomHeight;
  const paddingNeeded = Math.max(0, rows - usedLines);
  for (let i = 0; i < paddingNeeded; i++) {
    buf.push('');
  }

  buf.push(...bottomBuf);

  return buf.join(CLEAR_EOL + '\n');
}

export function truncateLine(str: string, maxWidth: number): string {
  const { reset } = getActivePalette();
  let visPos = 0;
  let rawPos = 0;
  while (rawPos < str.length) {
    if (str[rawPos] === '\x1b') {
      const match = str.substring(rawPos).match(/^\x1b\[[0-9;?]*[a-zA-Z]/);
      if (match) { rawPos += match[0].length; continue; }
      const oscMatch = str.substring(rawPos).match(/^\x1b\][^\x07]*\x07/);
      if (oscMatch) { rawPos += oscMatch[0].length; continue; }
    }
    if (visPos >= maxWidth) {
      return str.substring(0, rawPos) + reset;
    }
    visPos++;
    rawPos++;
  }
  return str;
}

export function highlightSearchInLine(line: string, query: string, baseColor?: string): string {
  const { reverse, yellow, reset } = getActivePalette();
  if (!query) return line;
  const lowerLine = line.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const restore = baseColor || '';
  let result = '';
  let pos = 0;
  while (pos < line.length) {
    const idx = lowerLine.indexOf(lowerQuery, pos);
    if (idx === -1) {
      result += line.substring(pos);
      break;
    }
    result += line.substring(pos, idx);
    result += `${reverse}${yellow}${line.substring(idx, idx + query.length)}${reset}${restore}`;
    pos = idx + query.length;
  }
  return result;
}

export function wrapPlainLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) return [line];
  const result: string[] = [];
  for (let i = 0; i < line.length; i += width) {
    result.push(line.substring(i, i + width));
  }
  return result;
}

export function renderLogView(state: AppState): string {
  const { reset, bold, dim, green, yellow, red } = getActivePalette();
  const columns = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const buf: string[] = [];

  for (const line of renderLogo()) {
    buf.push(line);
  }
  buf.push(separatorLine(columns));
  const hasLogSearch = !!state.logSearchQuery && !state.logSearchActive;
  buf.push(` ${renderLegend({ logsScrollMode: true, hasLogSearch })}`);

  const entry = state.flatList[state.cursor];
  const serviceName = entry ? entry.service : '???';
  const totalLines = state.logLines.length;

  let statusLine: string;
  if (state.logBuildKey) {
    const buildInfo = state.bottomLogLines.get(state.logBuildKey);
    const isBuilding = state.rebuilding.has(state.logBuildKey) || state.cascading.has(state.logBuildKey);
    if (buildInfo && buildInfo.action === 'build_failed') {
      statusLine = ` ${red}build failed ${bold}${serviceName}${reset}`;
    } else if (isBuilding) {
      statusLine = ` ${yellow}Build logs ${bold}${serviceName}${reset}`;
    } else {
      statusLine = ` ${yellow}Build logs ${bold}${serviceName}${reset}`;
    }
  } else {
    statusLine = ` ${green}Run logs ${bold}${serviceName}${reset}`;
  }
  let scrollStatus: string;
  if (state.logAutoScroll) {
    scrollStatus = `${green}live${reset}`;
  } else {
    const currentLine = Math.max(1, totalLines - state.logScrollOffset);
    const pct = totalLines > 0 ? Math.round((currentLine / totalLines) * 100) : 100;
    scrollStatus = `${yellow}paused ${dim}line ${currentLine} / ${totalLines} (${pct}%)${reset}`;
  }
  statusLine += `  ${scrollStatus}`;

  if (state.logSearchPending || state.logHistoryLoading) {
    statusLine += `  ${yellow}loading history...${reset}`;
  } else if (state.logSearchQuery && state.logSearchMatches.length > 0) {
    statusLine += `  ${dim}match ${state.logSearchMatchIdx + 1}/${state.logSearchMatches.length}${reset}`;
  } else if (state.logSearchQuery && state.logSearchMatches.length === 0) {
    statusLine += `  ${red}no matches${reset}`;
  }
  buf.push(statusLine);

  const bottomReserved = state.logSearchActive ? 1 : 0;
  const headerHeight = buf.length;
  const availableRows = Math.max(1, rows - headerHeight - bottomReserved);

  let endLine: number;
  if (state.logAutoScroll || state.logScrollOffset === 0) {
    endLine = totalLines;
  } else {
    endLine = Math.max(Math.min(availableRows, totalLines), totalLines - state.logScrollOffset);
  }

  if (totalLines === 0) {
    buf.push(`  ${dim}loading...${reset}`);
  }

  const searchQuery = state.logSearchQuery || '';
  const matchSet = searchQuery ? new Set(state.logSearchMatches) : null;
  const patterns = state.config.logScanPatterns || [];

  // Build display lines by wrapping log lines, working backwards from endLine
  const displayLines: string[] = [];
  for (let i = endLine - 1; i >= 0 && displayLines.length < availableRows; i--) {
    const line = state.logLines[i];
    const wrapped = wrapPlainLine(line, columns);
    const isMatch = matchSet && matchSet.has(i);
    const lineColor = logLineColor(line, patterns);
    for (let w = wrapped.length - 1; w >= 0; w--) {
      let segment = wrapped[w];
      if (isMatch) {
        segment = highlightSearchInLine(segment, searchQuery, lineColor || undefined);
      }
      if (lineColor) {
        segment = `${lineColor}${segment}${reset}`;
      }
      displayLines.push(segment);
    }
  }
  displayLines.reverse();
  // Trim to fit available rows (keep the bottom portion)
  const trimmed = displayLines.length > availableRows
    ? displayLines.slice(displayLines.length - availableRows)
    : displayLines;
  buf.push(...trimmed);

  const targetRows = rows - bottomReserved;
  for (let i = buf.length; i < targetRows; i++) {
    buf.push('');
  }

  if (state.logSearchActive) {
    buf.push(`${bold}/${reset}${state.logSearchQuery}${bold}_${reset}`);
  }

  return buf.join(CLEAR_EOL + '\n');
}

export function renderExecView(state: AppState): string {
  const { reset, bold, dim, green, yellow, cyan } = getActivePalette();
  const columns = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const buf: string[] = [];

  for (const line of renderLogo()) {
    buf.push(line);
  }
  buf.push(separatorLine(columns));
  buf.push(` ${renderLegend({ execMode: true })}`);

  const serviceName = state.execService || '???';
  const runningIndicator = state.execChild ? `${yellow}running${reset}` : `${green}ready${reset}`;
  const cwdInfo = state.execCwd ? `  ${dim}${state.execCwd}${reset}` : '';
  buf.push(` ${cyan}exec ${bold}${serviceName}${reset}  ${runningIndicator}${cwdInfo}`);

  const headerHeight = buf.length;
  // Reserve 1 line for the prompt at the bottom
  const availableRows = Math.max(1, rows - headerHeight - 1);

  const totalLines = state.execOutputLines.length;
  const startLine = Math.max(0, totalLines - availableRows);
  for (let i = startLine; i < totalLines; i++) {
    buf.push(truncateLine(`  ${state.execOutputLines[i]}`, columns));
  }

  // Pad empty space
  const usedLines = buf.length + 1; // +1 for prompt
  const paddingNeeded = Math.max(0, rows - usedLines);
  for (let i = 0; i < paddingNeeded; i++) {
    buf.push('');
  }

  // Command prompt
  buf.push(`${green}$ ${reset}${state.execInput}${bold}_${reset}`);

  return buf.join(CLEAR_EOL + '\n');
}
