'use strict';

const { statusKey, MODE } = require('./state');

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
  ` ${ITALIC}${BOLD}${FG_CYAN}┌─┐┌─┐┌─┐┌─┐┌┬┐┌─┐┌─┐┌─┐┌─┐┌┐ ┬  ┌─┐${RESET}`,
  ` ${ITALIC}${BOLD}${FG_CYAN}├┬┘├┤ │  │ ││││├─┘│ │└─┐├─┤├┴┐│  ├┤${RESET}`,
  ` ${ITALIC}${BOLD}${FG_CYAN}┴└─└─┘└─┘└─┘┴ ┴┴  └─┘└─┘┴ ┴└─┘┴─┘└─┘${RESET}`,
  ``,
  ` ${DIM}docker compose manager${RESET}`,
  ``,
];

function visLen(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padVisible(str, width) {
  const pad = Math.max(0, width - visLen(str));
  return str + ' '.repeat(pad);
}

function padVisibleStart(str, width) {
  const pad = Math.max(0, width - visLen(str));
  return ' '.repeat(pad) + str;
}

const PATTERN_COLORS = [FG_YELLOW, FG_RED, FG_CYAN, FG_WHITE];

function patternLabel(pattern) {
  return pattern.replace(/^[\[\(\{<]/, '').replace(/[\]\)\}>]$/, '');
}

function parseTimestamp(ts) {
  if (!ts) return null;
  // Strip trailing timezone abbreviation (e.g., "UTC", "CET")
  const cleaned = ts.replace(/ [A-Z]{2,5}$/, '');
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

function relativeTime(ts) {
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

function clearScreen() {
  return `${ESC}2J${ESC}H${ESC}?25l`;
}

function showCursor() {
  return `${ESC}?25h`;
}

function statusIcon(status, isRebuilding, isRestarting, isStopping, isStarting) {
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

function statusText(status, isRebuilding, isRestarting, isStopping, isStarting) {
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

function formatMem(bytes) {
  if (bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function renderLegend(opts = {}) {
  const { logPanelActive = false, fullLogsActive = false, logsScrollMode = false, noCacheActive = false } = opts;
  const item = (text, active) => {
    if (active) return `${BG_HIGHLIGHT} ${text} ${RESET}`;
    return `${DIM}${text}${RESET}`;
  };
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
    item('[S]tart/restart', false),
    item('Sto[P]', false),
    item('[N]o cache', noCacheActive),
    item('[F]ull logs', fullLogsActive),
    item('[L]og panel', logPanelActive),
    item('[Q]uit', false),
  ].join('  ');
}

function renderListView(state) {
  const { columns = 80, rows = 24 } = process.stdout;
  const patterns = state.config.logScanPatterns || [];
  const buf = [];

  // Logo
  for (const line of LOGO) {
    buf.push(line);
  }
  const help = renderLegend({ logPanelActive: state.showBottomLogs, noCacheActive: state.noCache });
  buf.push(` ${FG_GRAY}${'─'.repeat(Math.max(0, columns - 2))}${RESET}`);
  buf.push(` ${help}`);

  const headerHeight = buf.length;

  // Build bottom panel content — show logs for the currently selected container
  const bottomBuf = [];
  if (state.showBottomLogs) {
    const selEntry = state.flatList[state.cursor];
    if (selEntry) {
      const sk = statusKey(selEntry.file, selEntry.service);
      const info = state.bottomLogLines.get(sk);
      if (info) {
        bottomBuf.push(` ${FG_GRAY}${'─'.repeat(Math.max(0, columns - 2))}${RESET}`);
        const actionColor = info.action === 'rebuilding' || info.action === 'restarting' || info.action === 'stopping' || info.action === 'starting' ? FG_YELLOW : FG_GREEN;
        let headerLine = ` ${actionColor}${info.action} ${BOLD}${info.service}${RESET}`;
        // Show search info
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
          // Highlight search query
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
          // Highlight log scan patterns
          for (let pi = 0; pi < patterns.length; pi++) {
            const p = patterns[pi];
            if (coloredLine.includes(p)) {
              const color = PATTERN_COLORS[pi % PATTERN_COLORS.length];
              coloredLine = coloredLine.split(p).join(`${color}${p}${RESET}${FG_GRAY}`);
            }
          }
          bottomBuf.push(`  ${FG_GRAY}${coloredLine}${RESET}`);
        }

        // Search prompt
        if (state.bottomSearchActive) {
          bottomBuf.push(`${BOLD}/${RESET}${state.bottomSearchQuery}${BOLD}_${RESET}`);
        }
      }
    }
  }
  const bottomHeight = bottomBuf.length;

  // Build all display lines
  const lines = [];
  let currentGroup = -1;

  for (let i = 0; i < state.flatList.length; i++) {
    const entry = state.flatList[i];

    // Group header
    if (entry.groupIdx !== currentGroup) {
      currentGroup = entry.groupIdx;
      const group = state.groups[entry.groupIdx];
      if (lines.length > 0) lines.push({ type: 'blank' });
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
    const icon = statusIcon(st, rebuilding, restarting, stopping, starting);
    const stext = statusText(st, rebuilding, restarting, stopping, starting);
    const name = entry.service.padEnd(24);
    const statusPadded = padVisible(stext, 22);

    // CPU/MEM column
    let cpuMemStr;
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

    // Ports column
    let portsStr;
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
      text: `${pointer}   ${icon} ${FG_WHITE}${name}${RESET} ${statusPadded} ${built} ${restarted}${countsStr}  ${cpuMemStr} ${portsStr}${endPointer}`,
      flatIdx: i,
    });
  }

  // Scrolling
  const availableRows = Math.max(3, rows - headerHeight - bottomHeight);

  // Find line index of cursor
  const cursorLineIdx = lines.findIndex(l => l.type === 'service' && l.flatIdx === state.cursor);

  // Adjust scroll offset
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

  // Pad to push bottom panel to the bottom of the terminal
  const usedLines = buf.length + bottomHeight;
  const paddingNeeded = Math.max(0, rows - usedLines);
  for (let i = 0; i < paddingNeeded; i++) {
    buf.push('');
  }

  // Bottom panel
  buf.push(...bottomBuf);

  return buf.join('\n');
}

function truncateLine(str, maxWidth) {
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

function highlightSearchInLine(line, query) {
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

function renderLogView(state) {
  const { columns = 80, rows = 24 } = process.stdout;
  const buf = [];

  for (const line of LOGO) {
    buf.push(line);
  }
  buf.push(` ${FG_GRAY}${'─'.repeat(Math.max(0, columns - 2))}${RESET}`);
  buf.push(` ${renderLegend({ logsScrollMode: true })}`);

  const entry = state.flatList[state.cursor];
  const serviceName = entry ? entry.service : '???';
  const totalLines = state.logLines.length;

  let statusLine = ` ${FG_GREEN}full logs ${BOLD}${serviceName}${RESET}`;
  const scrollStatus = state.logAutoScroll
    ? `${FG_GREEN}live${RESET}`
    : `${FG_YELLOW}paused ${DIM}line ${Math.max(1, totalLines - state.logScrollOffset)} / ${totalLines}${RESET}`;
  statusLine += `  ${scrollStatus}`;

  // Show search match count
  if (state.logSearchQuery && state.logSearchMatches.length > 0) {
    statusLine += `  ${DIM}match ${state.logSearchMatchIdx + 1}/${state.logSearchMatches.length}${RESET}`;
  } else if (state.logSearchQuery && state.logSearchMatches.length === 0) {
    statusLine += `  ${FG_RED}no matches${RESET}`;
  }
  buf.push(statusLine);

  // Reserve 1 row for search prompt if active
  const bottomReserved = state.logSearchActive ? 1 : 0;
  const headerHeight = buf.length;
  const availableRows = Math.max(1, rows - headerHeight - bottomReserved);

  let endLine;
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

  // Pad to fill screen
  const targetRows = rows - bottomReserved;
  for (let i = buf.length; i < targetRows; i++) {
    buf.push('');
  }

  // Search prompt at the bottom
  if (state.logSearchActive) {
    buf.push(`${BOLD}/${RESET}${state.logSearchQuery}${BOLD}_${RESET}`);
  }

  return buf.join('\n');
}

module.exports = { clearScreen, showCursor, renderListView, renderLogView };
