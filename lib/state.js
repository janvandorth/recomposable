'use strict';

const MODE = { LIST: 'LIST', LOGS: 'LOGS' };

function createState(config) {
  return {
    mode: MODE.LIST,
    groups: [],       // [{ file, label, services: string[], error: string|null }]
    flatList: [],     // [{ groupIdx, serviceIdx, service, file }]
    cursor: 0,
    statuses: new Map(),   // "file::service" -> { state, health }
    rebuilding: new Map(), // "file::service" -> childProcess
    restarting: new Map(), // "file::service" -> childProcess
    logChild: null,
    scrollOffset: 0,
    showBottomLogs: true,
    bottomLogLines: new Map(), // statusKey -> { action, service, lines: [] }
    bottomLogTails: new Map(), // statusKey -> childProcess (log tail after restart)
    selectedLogKey: null,      // statusKey of cursor-selected container for log tailing
    logCounts: new Map(),      // statusKey -> Map<pattern, count>
    logLines: [],              // buffered log lines for full log view
    logScrollOffset: 0,        // lines from bottom (0 = at bottom)
    logAutoScroll: true,       // auto-scroll to bottom on new data
    config,
  };
}

function statusKey(file, service) {
  return `${file}::${service}`;
}

function buildFlatList(groups) {
  const list = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    for (let si = 0; si < g.services.length; si++) {
      list.push({ groupIdx: gi, serviceIdx: si, service: g.services[si], file: g.file });
    }
  }
  return list;
}

function moveCursor(state, delta) {
  if (state.flatList.length === 0) return;
  state.cursor = Math.max(0, Math.min(state.flatList.length - 1, state.cursor + delta));
}

function selectedEntry(state) {
  return state.flatList[state.cursor] || null;
}

module.exports = { MODE, createState, statusKey, buildFlatList, moveCursor, selectedEntry };
