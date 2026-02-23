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

const LOGO = [
  `${FG_CYAN}        .  ·  ˙               __      __ _  _   _   _    ___${RESET}`,
  `${FG_CYAN}    _  ·        ˙ .           \\ \\    / /| || | /_\\ | |  | __|${RESET}`,
  `${FG_CYAN}   / \`·._________ )            \\ \\/\\/ / | __ |/ _ \\| |__| _|${RESET}`,
  `${FG_CYAN}  |    __        /              \\_/\\_/  |_||_/_/ \\_|____|___|${RESET}`,
  `${FG_CYAN}  \\ _/  o\\___.-\`${RESET}`,
  `${FG_CYAN}   \\____/  ~  ~  ~${RESET}`,
];

function clearScreen() {
  return `${ESC}2J${ESC}H${ESC}?25l`;
}

function showCursor() {
  return `${ESC}?25h`;
}

function statusIcon(status, isRebuilding) {
  if (isRebuilding) return `${FG_YELLOW}\u25CF${RESET}`;
  if (!status) return `${FG_GRAY}\u25CB${RESET}`;

  const { state, health } = status;
  if (state === 'running') {
    if (health === 'unhealthy') return `${FG_RED}\u25CF${RESET}`;
    return `${FG_GREEN}\u25CF${RESET}`;
  }
  if (state === 'restarting') return `${FG_YELLOW}\u25CF${RESET}`;
  return `${FG_GRAY}\u25CB${RESET}`;
}

function statusText(status, isRebuilding) {
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

function renderListView(state) {
  const { columns = 80, rows = 24 } = process.stdout;
  const buf = [];

  // Logo + header
  for (const line of LOGO) buf.push(` ${line}`);
  const help = `${DIM}[R]ebuild  [L]ogs  [Q]uit${RESET}`;
  buf.push(` ${FG_GRAY}${'─'.repeat(Math.max(0, columns - 2))}${RESET}  ${help}`);
  buf.push('');

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
    }

    const sk = statusKey(entry.file, entry.service);
    const st = state.statuses.get(sk);
    const rebuilding = state.rebuilding.has(sk);
    const icon = statusIcon(st, rebuilding);
    const stext = statusText(st, rebuilding);
    const name = entry.service.padEnd(30);
    const pointer = i === state.cursor ? `${REVERSE}` : '';
    const endPointer = i === state.cursor ? `${RESET}` : '';

    lines.push({
      type: 'service',
      text: `${pointer}   ${icon} ${FG_WHITE}${name}${RESET} ${stext}${endPointer}`,
      flatIdx: i,
    });
  }

  // Scrolling
  const availableRows = rows - (LOGO.length + 3); // logo + ruler + blank + bottom margin
  const serviceLines = lines.filter(l => l.type === 'service');

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

  return buf.join('\n');
}

function renderLogHeader(serviceName) {
  const { columns = 80 } = process.stdout;
  const title = `${BOLD}${FG_CYAN} whale${RESET} ${FG_GRAY}>${RESET} ${BOLD}${serviceName}${RESET} ${DIM}logs${RESET}`;
  const help = `${DIM}[L] or [Esc] back${RESET}`;
  const pad = Math.max(0, columns - serviceName.length - 21 - 17);
  const buf = [];
  buf.push(title + ' '.repeat(pad) + help);
  buf.push(` ${FG_GRAY}${'─'.repeat(Math.max(0, columns - 2))}${RESET}`);
  return buf.join('\n');
}

module.exports = { clearScreen, showCursor, renderListView, renderLogHeader };
