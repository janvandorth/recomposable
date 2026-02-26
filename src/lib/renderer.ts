import { statusKey, MODE } from './state';
import type { AppState, LegendOptions, DisplayLine } from './types';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const REVERSE = `${ESC}7m`;
const FG_GREEN = `${ESC}32m`;
const FG_YELLOW = `${ESC}33m`;
const FG_RED = `${ESC}31m`;
const FG_GRAY = `${ESC}90m`;
const FG_CYAN = `${ESC}36m`;
const FG_WHITE = `${ESC}37m`;

const ITALIC = `${ESC}3m`;
const BG_HIGHLIGHT = `${ESC}48;5;237m`;

const LOGO = [
  ` ${ITALIC}${BOLD}${FG_CYAN}\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u252C\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2500\u2510\u250C\u2510 \u252C  \u250C\u2500\u2510${RESET}`,
  ` ${ITALIC}${BOLD}${FG_CYAN}\u251C\u252C\u2518\u251C\u2524 \u2502  \u2502 \u2502\u2502\u2502\u2502\u251C\u2500\u2518\u2502 \u2502\u2514\u2500\u2510\u251C\u2500\u2524\u251C\u2534\u2510\u2502  \u251C\u2524${RESET}`,
  ` ${ITALIC}${BOLD}${FG_CYAN}\u2534\u2514\u2500\u2514\u2500\u2518\u2514\u2500\u2518\u2514\u2500\u2518\u2534 \u2534\u2534  \u2514\u2500\u2518\u2514\u2500\u2518\u2534 \u2534\u2514\u2500\u2518\u2534\u2500\u2518\u2514\u2500\u2518${RESET}`,
  ``,
  ` ${DIM}docker compose manager${RESET}`,
  ``,
];

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

const PATTERN_COLORS = [FG_YELLOW, FG_RED, FG_CYAN, FG_WHITE];

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
  const date = parseTimestamp(ts);
  if (!date) return `${FG_GRAY}-${RESET}`;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return `${FG_GRAY}-${RESET}`;
  if (seconds < 60) return `${DIM}${seconds}s ago${RESET}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${DIM}${minutes}m ago${RESET}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${DIM}${hours}h ago${RESET}`;
  const days = Math.floor(hours / 24);
  return `${DIM}${days}d ago${RESET}`;
}

export function clearScreen(): string {
  return `${ESC}2J${ESC}H${ESC}?25l`;
}

export function showCursor(): string {
  return `${ESC}?25h`;
}

export function statusIcon(status: { state: string; health: string } | null | undefined, isRebuilding: boolean, isRestarting: boolean, isStopping: boolean, isStarting: boolean): string {
  if (isRebuilding || isRestarting || isStopping || isStarting) return `${FG_YELLOW}\u25CF${RESET}`;
  if (!status) return `${FG_GRAY}\u25CB${RESET}`;

  const { state, health } = status;
  if (state === 'running') {
    if (health === 'unhealthy') return `${FG_RED}\u25CF${RESET}`;
    return `${FG_GREEN}\u25CF${RESET}`;
  }
  if (state === 'restarting') return `${FG_YELLOW}\u25CF${RESET}`;
  return `${FG_GRAY}\u25CB${RESET}`;
}

export function statusText(status: { state: string; health: string } | null | undefined, isRebuilding: boolean, isRestarting: boolean, isStopping: boolean, isStarting: boolean): string {
  if (isStopping) return `${FG_YELLOW}STOPPING...${RESET}`;
  if (isStarting) return `${FG_YELLOW}STARTING...${RESET}`;
  if (isRestarting) return `${FG_YELLOW}RESTARTING...${RESET}`;
  if (isRebuilding) return `${FG_YELLOW}REBUILDING...${RESET}`;
  if (!status) return `${FG_GRAY}stopped${RESET}`;

  const { state, health } = status;
  let text = state;
  if (health && health !== 'none' && health !== '') {
    text += ` (${health})`;
  }

  if (state === 'running') {
    if (health === 'unhealthy') return `${FG_RED}${text}${RESET}`;
    return `${FG_GREEN}${text}${RESET}`;
  }
  if (state === 'exited') return `${FG_GRAY}${text}${RESET}`;
  if (state === 'restarting') return `${FG_YELLOW}${text}${RESET}`;
  return `${DIM}${text}${RESET}`;
}

export function formatMem(bytes: number): string {
  if (bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

export function renderLegend(opts: LegendOptions = {}): string {
  const { logPanelActive = false, logsScrollMode = false, noCacheActive = false, watchActive = false, execMode = false, execInline = false } = opts;
  const item = (text: string, active: boolean): string => {
    if (active) return `${BG_HIGHLIGHT} ${text} ${RESET}`;
    return `${DIM}${text}${RESET}`;
  };
  if (execMode) {
    return [
      item('[Esc] back', false),
      item('[Enter] run', false),
      item('[Up/Down] history', false),
      item('[Ctrl+C] kill', false),
      item('[Q]uit', false),
    ].join('  ');
  }
  if (execInline) {
    return [
      item('[Esc] back', false),
      item('[Enter] run', false),
      item('[Up/Down] history', false),
      item('[Ctrl+C] kill', false),
      item('[x] full screen', false),
      item('[Q]uit', false),
    ].join('  ');
  }
  if (logsScrollMode) {
    return [
      item('[Esc] back', false),
      item('[j/k] scroll', false),
      item('[G] bottom', false),
      item('[gg] top', false),
      item('[/] search', false),
      item('[n/N] next/prev', false),
      item('[Q]uit', false),
    ].join('  ');
  }
  return [
    item('Re[B]uild', false),
    item('[D]ep rebuild', false),
    item('[S]tart/restart', false),
    item('Sto[P]', false),
    item('[W]atch', watchActive),
    item('[N]o cache', noCacheActive),
    item('[e]xec', false),
    item('[F]ull logs', false),
    item('[L]og panel', logPanelActive),
    item('[Q]uit', false),
  ].join('  ');
}

export function renderListView(state: AppState): string {
  const columns = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const patterns = state.config.logScanPatterns || [];
  const buf: string[] = [];

  for (const line of LOGO) {
    buf.push(line);
  }
  const watchActive = state.watching.size > 0;
  const help = state.execActive
    ? renderLegend({ execInline: true })
    : renderLegend({ logPanelActive: state.showBottomLogs, noCacheActive: state.noCache, watchActive });
  buf.push(` ${FG_GRAY}${'\u2500'.repeat(Math.max(0, columns - 2))}${RESET}`);
  buf.push(` ${help}`);

  const headerHeight = buf.length;

  const bottomBuf: string[] = [];
  if (state.execActive && state.execService) {
    bottomBuf.push(` ${FG_GRAY}${'\u2500'.repeat(Math.max(0, columns - 2))}${RESET}`);
    const runningIndicator = state.execChild ? `${FG_YELLOW}running${RESET}` : `${FG_GREEN}ready${RESET}`;
    const cwdInfo = state.execCwd ? `  ${DIM}${state.execCwd}${RESET}` : '';
    bottomBuf.push(` ${FG_CYAN}exec ${BOLD}${state.execService}${RESET}  ${runningIndicator}${cwdInfo}`);
    const maxOutputLines = Math.max(1, (state.config.bottomLogCount || 10) - 1);
    const outputStart = Math.max(0, state.execOutputLines.length - maxOutputLines);
    for (let i = outputStart; i < state.execOutputLines.length; i++) {
      bottomBuf.push(truncateLine(`  ${state.execOutputLines[i]}`, columns));
    }
    bottomBuf.push(`${FG_GREEN}$ ${RESET}${state.execInput}${BOLD}_${RESET}`);
  } else if (state.showBottomLogs) {
    const selEntry = state.flatList[state.cursor];
    if (selEntry) {
      const sk = statusKey(selEntry.file, selEntry.service);

      // Check for cascade progress
      const cascade = state.cascading.get(sk);
      if (cascade) {
        bottomBuf.push(` ${FG_GRAY}${'\u2500'.repeat(Math.max(0, columns - 2))}${RESET}`);
        bottomBuf.push(` ${FG_YELLOW}cascading ${BOLD}${selEntry.service}${RESET}`);
        for (let si = 0; si < cascade.steps.length; si++) {
          const step = cascade.steps[si];
          let marker: string;
          switch (step.status) {
            case 'completed': marker = `${FG_GREEN}[done]${RESET}`; break;
            case 'in_progress': marker = `${FG_YELLOW}[>>> ]${RESET}`; break;
            case 'failed': marker = `${FG_RED}[FAIL]${RESET}`; break;
            default: marker = `${DIM}[    ]${RESET}`;
          }
          bottomBuf.push(`  ${marker} ${step.action} ${BOLD}${step.service}${RESET}`);
        }
      }

      const info = state.bottomLogLines.get(sk);
      if (info) {
        if (!cascade) {
          bottomBuf.push(` ${FG_GRAY}${'\u2500'.repeat(Math.max(0, columns - 2))}${RESET}`);
        }
        const actionColor = info.action === 'rebuilding' || info.action === 'restarting' || info.action === 'stopping' || info.action === 'starting' || info.action === 'cascading' ? FG_YELLOW
          : info.action === 'watching' ? FG_CYAN : FG_GREEN;
        let headerLine = ` ${actionColor}${info.action} ${BOLD}${info.service}${RESET}`;
        const bq = state.bottomSearchQuery || '';
        if (bq && !state.bottomSearchActive) {
          const matchCount = info.lines.filter(l => l.toLowerCase().includes(bq.toLowerCase())).length;
          headerLine += matchCount > 0
            ? `  ${DIM}search: "${bq}" (${matchCount} match${matchCount !== 1 ? 'es' : ''})${RESET}`
            : `  ${FG_RED}search: "${bq}" (no matches)${RESET}`;
        }
        bottomBuf.push(headerLine);

        const searchQuery = bq && !state.bottomSearchActive ? bq : '';

        for (const line of info.lines) {
          let coloredLine = line.substring(0, columns - 4);
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
                result += `${REVERSE}${FG_YELLOW}${coloredLine.substring(idx, idx + searchQuery.length)}${RESET}${FG_GRAY}`;
                pos = idx + searchQuery.length;
              }
              coloredLine = result;
            }
          }
          for (let pi = 0; pi < patterns.length; pi++) {
            const p = patterns[pi];
            if (coloredLine.includes(p)) {
              const color = PATTERN_COLORS[pi % PATTERN_COLORS.length];
              coloredLine = coloredLine.split(p).join(`${color}${p}${RESET}${FG_GRAY}`);
            }
          }
          bottomBuf.push(`  ${FG_GRAY}${coloredLine}${RESET}`);
        }

        if (state.bottomSearchActive) {
          bottomBuf.push(`${BOLD}/${RESET}${state.bottomSearchQuery}${BOLD}_${RESET}`);
        }
      }
    }
  }
  const bottomHeight = bottomBuf.length;

  const lines: DisplayLine[] = [];
  let currentGroup = -1;

  for (let i = 0; i < state.flatList.length; i++) {
    const entry = state.flatList[i];

    if (entry.groupIdx !== currentGroup) {
      currentGroup = entry.groupIdx;
      const group = state.groups[entry.groupIdx];
      if (lines.length > 0) lines.push({ type: 'blank', text: '' });
      const label = ` ${BOLD}${group.label}${RESET}`;
      if (group.error) {
        lines.push({ type: 'header', text: `${label}  ${FG_RED}(${group.error})${RESET}` });
      } else {
        lines.push({ type: 'header', text: label });
      }
      let colHeader = `${DIM}     ${'SERVICE'.padEnd(24)} ${'STATUS'.padEnd(22)} ${'BUILT'.padEnd(12)} ${'RESTARTED'.padEnd(12)}`;
      for (const p of patterns) colHeader += patternLabel(p).padStart(5) + ' ';
      colHeader += `   ${'CPU/MEM'.padStart(16)} ${'PORTS'.padEnd(14)}`;
      lines.push({ type: 'colheader', text: colHeader + RESET });
    }

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
    const watchIndicator = isWatching ? `${FG_CYAN}W${RESET}` : ' ';
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
      let color = DIM;
      if (cpu > cpuDanger || mem > memDanger) color = FG_RED;
      else if (cpu > cpuWarn || mem > memWarn) color = FG_YELLOW;
      const cpuText = cpu.toFixed(1) + '%';
      const memText = formatMem(mem);
      cpuMemStr = padVisible(`${color}${cpuText} / ${memText}${RESET}`, 16);
    } else {
      cpuMemStr = padVisible(`${DIM}-${RESET}`, 16);
    }

    let portsStr: string;
    if (st && st.ports && st.ports.length > 0) {
      const portsText = st.ports.map(p => p.published).join(' ');
      portsStr = padVisible(`${DIM}${portsText}${RESET}`, 14);
    } else {
      portsStr = padVisible(`${DIM}-${RESET}`, 14);
    }

    const built = padVisible(relativeTime(st ? st.createdAt : null), 12);
    const restarted = padVisible(relativeTime(st ? st.startedAt : null), 12);
    const pointer = i === state.cursor ? `${REVERSE}` : '';
    const endPointer = i === state.cursor ? `${RESET}` : '';

    let countsStr = '';
    const logCounts = state.logCounts.get(sk);
    for (let pi = 0; pi < patterns.length; pi++) {
      const count = logCounts ? (logCounts.get(patterns[pi]) || 0) : 0;
      const color = count > 0 ? PATTERN_COLORS[pi % PATTERN_COLORS.length] : DIM;
      const countText = count > 0 ? `${color}${count}${RESET}` : `${color}-${RESET}`;
      countsStr += padVisibleStart(countText, 5) + ' ';
    }

    lines.push({
      type: 'service',
      text: `${pointer}  ${watchIndicator}${icon} ${FG_WHITE}${name}${RESET} ${statusPadded} ${built} ${restarted}${countsStr}  ${cpuMemStr} ${portsStr}${endPointer}`,
      flatIdx: i,
    });
  }

  const availableRows = Math.max(3, rows - headerHeight - bottomHeight);

  const cursorLineIdx = lines.findIndex(l => l.type === 'service' && l.flatIdx === state.cursor);

  if (cursorLineIdx < state.scrollOffset) {
    state.scrollOffset = cursorLineIdx;
  } else if (cursorLineIdx >= state.scrollOffset + availableRows) {
    state.scrollOffset = cursorLineIdx - availableRows + 1;
  }
  state.scrollOffset = Math.max(0, Math.min(lines.length - availableRows, state.scrollOffset));

  const visible = lines.slice(state.scrollOffset, state.scrollOffset + availableRows);
  for (const line of visible) {
    buf.push(line.text || '');
  }

  const usedLines = buf.length + bottomHeight;
  const paddingNeeded = Math.max(0, rows - usedLines);
  for (let i = 0; i < paddingNeeded; i++) {
    buf.push('');
  }

  buf.push(...bottomBuf);

  return buf.join('\n');
}

export function truncateLine(str: string, maxWidth: number): string {
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
      return str.substring(0, rawPos) + RESET;
    }
    visPos++;
    rawPos++;
  }
  return str;
}

export function highlightSearchInLine(line: string, query: string): string {
  if (!query) return line;
  const lowerLine = line.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let result = '';
  let pos = 0;
  while (pos < line.length) {
    const idx = lowerLine.indexOf(lowerQuery, pos);
    if (idx === -1) {
      result += line.substring(pos);
      break;
    }
    result += line.substring(pos, idx);
    result += `${REVERSE}${FG_YELLOW}${line.substring(idx, idx + query.length)}${RESET}`;
    pos = idx + query.length;
  }
  return result;
}

export function renderLogView(state: AppState): string {
  const columns = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const buf: string[] = [];

  for (const line of LOGO) {
    buf.push(line);
  }
  buf.push(` ${FG_GRAY}${'\u2500'.repeat(Math.max(0, columns - 2))}${RESET}`);
  buf.push(` ${renderLegend({ logsScrollMode: true })}`);

  const entry = state.flatList[state.cursor];
  const serviceName = entry ? entry.service : '???';
  const totalLines = state.logLines.length;

  let statusLine = ` ${FG_GREEN}full logs ${BOLD}${serviceName}${RESET}`;
  const scrollStatus = state.logAutoScroll
    ? `${FG_GREEN}live${RESET}`
    : `${FG_YELLOW}paused ${DIM}line ${Math.max(1, totalLines - state.logScrollOffset)} / ${totalLines}${RESET}`;
  statusLine += `  ${scrollStatus}`;

  if (state.logSearchQuery && state.logSearchMatches.length > 0) {
    statusLine += `  ${DIM}match ${state.logSearchMatchIdx + 1}/${state.logSearchMatches.length}${RESET}`;
  } else if (state.logSearchQuery && state.logSearchMatches.length === 0) {
    statusLine += `  ${FG_RED}no matches${RESET}`;
  }
  buf.push(statusLine);

  const bottomReserved = state.logSearchActive ? 1 : 0;
  const headerHeight = buf.length;
  const availableRows = Math.max(1, rows - headerHeight - bottomReserved);

  let endLine: number;
  if (state.logAutoScroll || state.logScrollOffset === 0) {
    endLine = totalLines;
  } else {
    endLine = Math.max(0, totalLines - state.logScrollOffset);
  }
  const startLine = Math.max(0, endLine - availableRows);

  const searchQuery = state.logSearchQuery || '';
  const matchSet = searchQuery ? new Set(state.logSearchMatches) : null;

  for (let i = startLine; i < endLine; i++) {
    let line = state.logLines[i];
    if (matchSet && matchSet.has(i)) {
      line = highlightSearchInLine(line, searchQuery);
    }
    buf.push(truncateLine(line, columns));
  }

  const targetRows = rows - bottomReserved;
  for (let i = buf.length; i < targetRows; i++) {
    buf.push('');
  }

  if (state.logSearchActive) {
    buf.push(`${BOLD}/${RESET}${state.logSearchQuery}${BOLD}_${RESET}`);
  }

  return buf.join('\n');
}

export function renderExecView(state: AppState): string {
  const columns = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  const buf: string[] = [];

  for (const line of LOGO) {
    buf.push(line);
  }
  buf.push(` ${FG_GRAY}${'\u2500'.repeat(Math.max(0, columns - 2))}${RESET}`);
  buf.push(` ${renderLegend({ execMode: true })}`);

  const serviceName = state.execService || '???';
  const runningIndicator = state.execChild ? `${FG_YELLOW}running${RESET}` : `${FG_GREEN}ready${RESET}`;
  const cwdInfo = state.execCwd ? `  ${DIM}${state.execCwd}${RESET}` : '';
  buf.push(` ${FG_CYAN}exec ${BOLD}${serviceName}${RESET}  ${runningIndicator}${cwdInfo}`);

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
  buf.push(`${FG_GREEN}$ ${RESET}${state.execInput}${BOLD}_${RESET}`);

  return buf.join('\n');
}
