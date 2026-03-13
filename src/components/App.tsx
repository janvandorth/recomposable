import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, useInput, useStdout, useApp } from 'ink';
import { ThemeContext, getInkPalette, type InkPalette } from '../lib/inkTheme.js';
import { MODE } from '../lib/state.js';
import { ListScreen } from './ListScreen.js';
import { LogScreen } from './LogScreen.js';
import { ExecScreen } from './ExecScreen.js';
import type { AppState } from '../lib/types.js';
import type { ThemeMode } from '../lib/theme.js';

interface AppProps {
  state: AppState;
  themeMode: ThemeMode;
  onKeypress: (key: string) => void;
}

export function App({ state, themeMode, onKeypress }: AppProps): React.ReactElement {
  const { stdout } = useStdout();
  const { exit } = useApp();
  const palette = getInkPalette(themeMode);
  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  // Re-render on state changes via a tick counter
  const [tick, setTick] = useState(0);
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // Expose a re-render trigger on the state object for imperative code
  const stateRef = useRef(state);
  stateRef.current = state;

  // The forceRender function is attached to state as _inkRender
  // Batched: multiple calls within the same microtask only trigger one re-render
  const pendingRef = useRef(false);
  useEffect(() => {
    (state as any)._inkRender = () => {
      if (!pendingRef.current) {
        pendingRef.current = true;
        queueMicrotask(() => {
          pendingRef.current = false;
          setTick(t => t + 1);
        });
      }
    };
    return () => { delete (state as any)._inkRender; };
  }, [state]);

  // gg detection
  const gPendingRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = useCallback((input: string, key: any) => {
    const st = stateRef.current;

    // In text input modes, pass raw characters
    if (st.logSearchActive || st.bottomSearchActive || st.mode === MODE.EXEC || st.execActive) {
      if (key.escape) {
        onKeypress('\x1b');
      } else if (key.return) {
        onKeypress('\r');
      } else if (key.backspace || key.delete) {
        onKeypress('\x7f');
      } else if (key.upArrow) {
        onKeypress('\x1b[A');
      } else if (key.downArrow) {
        onKeypress('\x1b[B');
      } else if (key.ctrl && input === 'c') {
        onKeypress('\x03');
      } else if (input && input.length === 1 && input >= ' ') {
        onKeypress(input);
      }
      return;
    }

    // Worktree picker
    if (st.worktreePickerActive) {
      if (key.escape) onKeypress('\x1b');
      else if (key.return) onKeypress('\r');
      else if (input === 'j' || key.downArrow) onKeypress('j');
      else if (input === 'k' || key.upArrow) onKeypress('k');
      else if (input === 'G') onKeypress('G');
      return;
    }

    // Normal navigation modes
    if (key.escape) {
      onKeypress('\x1b');
      return;
    }
    if (key.return) {
      onKeypress('\r');
      return;
    }
    if (key.upArrow) {
      onKeypress('k');
      return;
    }
    if (key.downArrow) {
      onKeypress('j');
      return;
    }
    if (key.ctrl && input === 'c') {
      onKeypress('\x03');
      return;
    }
    if (key.ctrl && input === 'u') {
      onKeypress('\x15');
      return;
    }
    if (key.ctrl && input === 'd') {
      onKeypress('\x04');
      return;
    }

    // Handle 'g' -> 'gg' sequence
    if (input === 'g') {
      if (gPendingRef.current) {
        gPendingRef.current = false;
        if (gTimerRef.current) {
          clearTimeout(gTimerRef.current);
          gTimerRef.current = null;
        }
        // gg action
        if (st.mode === MODE.LIST) {
          onKeypress('gg');
        } else if (st.mode === MODE.LOGS) {
          onKeypress('gg');
        }
        return;
      }
      gPendingRef.current = true;
      gTimerRef.current = setTimeout(() => {
        gPendingRef.current = false;
        gTimerRef.current = null;
      }, 300);
      return;
    }

    // Any other key cancels pending g
    if (gPendingRef.current) {
      gPendingRef.current = false;
      if (gTimerRef.current) {
        clearTimeout(gTimerRef.current);
        gTimerRef.current = null;
      }
    }

    if (input) {
      onKeypress(input);
    }
  }, [onKeypress]);

  useInput(handleInput);

  return (
    <ThemeContext.Provider value={palette}>
      <Box flexDirection="column" height={rows - 1}>
        {state.mode === MODE.LIST && (
          <ListScreen state={state} columns={columns} rows={rows} />
        )}
        {state.mode === MODE.LOGS && (
          <LogScreen state={state} columns={columns} rows={rows} />
        )}
        {state.mode === MODE.EXEC && (
          <ExecScreen state={state} columns={columns} rows={rows} />
        )}
      </Box>
    </ThemeContext.Provider>
  );
}
