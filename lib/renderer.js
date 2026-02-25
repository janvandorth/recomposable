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

function statusIcon(status, isRebuilding, isRestarting) {
  if (isRebuilding || isRestarting) return `${FG_YELLOW}\u25CF${RESET}`;
  if (!status) return `${FG_GRAY}\u25CB${RESET}`;

  const { state, health } = status;
  if (state === 'running') {
    if (health === 'unhealthy') return `${FG_RED}\u25CF${RESET}`;
    return `${FG_GREEN}\u25CF${RESET}`;
  }
  if (state === 'restarting') return `${FG_YELLOW}\u25CF${RESET}`;
  return `${FG_GRAY}\u25CB${RESET}`;
}

function statusText(status, isRebuilding, isRestarting) {
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

function renderLegend(opts = {}) {
  const { logPanelActive = false, fullLogsActive = false, logsScrollMode = false } = opts;
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
      item('[Q]uit', false),
    ].join('  ');
  }
  return [
    item('[R]ebuild', false),
    item('[S]restart', false),
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
  const help = renderLegend({ logPanelActive: state.showBottomLogs });
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
        const actionColor = info.action === 'rebuilding' || info.action === 'restarting' ? FG_YELLOW : FG_GREEN;
        bottomBuf.push(` ${actionColor}${info.action} ${BOLD}${info.service}${RESET}`);
        for (const line of info.lines) {
          bottomBuf.push(`  ${FG_GRAY}${line.substring(0, columns - 4)}${RESET}`);
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
      lines.push({ type: 'colheader', text: colHeader + RESET });
    }

    const sk = statusKey(entry.file, entry.service);
    const st = state.statuses.get(sk);
    const rebuilding = state.rebuilding.has(sk);
    const restarting = state.restarting.has(sk);
    const icon = statusIcon(st, rebuilding, restarting);
    const stext = statusText(st, rebuilding, restarting);
    const name = entry.service.padEnd(24);
    const statusPadded = padVisible(stext, 22);
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
      text: `${pointer}   ${icon} ${FG_WHITE}${name}${RESET} ${statusPadded} ${built} ${restarted}${countsStr}${endPointer}`,
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

  const scrollStatus = state.logAutoScroll
    ? `${FG_GREEN}live${RESET}`
    : `${FG_YELLOW}paused ${DIM}line ${Math.max(1, totalLines - state.logScrollOffset)} / ${totalLines}${RESET}`;
  buf.push(` ${FG_GREEN}full logs ${BOLD}${serviceName}${RESET}  ${scrollStatus}`);

  const headerHeight = buf.length;
  const availableRows = Math.max(1, rows - headerHeight);

  let endLine;
  if (state.logAutoScroll || state.logScrollOffset === 0) {
    endLine = totalLines;
  } else {
    endLine = Math.max(0, totalLines - state.logScrollOffset);
  }
  const startLine = Math.max(0, endLine - availableRows);

  for (let i = startLine; i < endLine; i++) {
    buf.push(truncateLine(state.logLines[i], columns));
  }

  // Pad to fill screen (prevents ghost content from previous render)
  for (let i = buf.length; i < rows; i++) {
    buf.push('');
  }

  return buf.join('\n');
}

module.exports = { clearScreen, showCursor, renderListView, renderLogView };
