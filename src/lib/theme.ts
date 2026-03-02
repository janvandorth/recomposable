const ESC = '\x1b[';

export interface ColorPalette {
  reset: string;
  bold: string;
  dim: string;
  italic: string;
  reverse: string;
  green: string;
  yellow: string;
  red: string;
  gray: string;
  cyan: string;
  magenta: string;
  logo: string;
  highlightBg: string;
}

export const DARK_PALETTE: ColorPalette = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  reverse: `${ESC}7m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  red: `${ESC}31m`,
  gray: `${ESC}90m`,
  cyan: `${ESC}36m`,
  magenta: `${ESC}35m`,
  logo: `${ESC}36m`,
  highlightBg: `${ESC}48;5;238m`,
};

export const LIGHT_PALETTE: ColorPalette = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  reverse: `${ESC}7m`,
  green: `${ESC}32m`,
  yellow: `${ESC}1;33m`,
  red: `${ESC}1;31m`,
  gray: `${ESC}90m`,
  cyan: `${ESC}36m`,
  magenta: `${ESC}35m`,
  logo: '',
  highlightBg: `${ESC}48;5;254m`,
};

export const NO_COLOR_PALETTE: ColorPalette = {
  reset: '',
  bold: '',
  dim: '',
  italic: '',
  reverse: '',
  green: '',
  yellow: '',
  red: '',
  gray: '',
  cyan: '',
  magenta: '',
  logo: '',
  highlightBg: '',
};

export type ThemeMode = 'light' | 'dark';

/**
 * Parse an OSC 11 response like `\x1b]11;rgb:RRRR/GGGG/BBBB\x07` or `\x1b]11;rgb:RRRR/GGGG/BBBB\x1b\\`
 * Returns 'light' if the background luminance is high, 'dark' otherwise, or null if unparseable.
 */
export function parseOsc11Response(response: string): ThemeMode | null {
  const match = response.match(/rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/);
  if (!match) return null;

  // Normalize to 0-255 range (values can be 2 or 4 hex digits)
  const normalize = (hex: string): number => {
    const val = parseInt(hex, 16);
    return hex.length <= 2 ? val : val >> 8;
  };

  const r = normalize(match[1]);
  const g = normalize(match[2]);
  const b = normalize(match[3]);

  // Relative luminance (simplified sRGB)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 128 ? 'light' : 'dark';
}

/**
 * Parse the COLORFGBG environment variable (e.g. "15;0" or "15;default;0").
 * The last number is the background color index.
 */
export function parseColorfgbg(val: string | undefined): ThemeMode | null {
  if (!val) return null;
  const parts = val.split(';');
  const bg = parseInt(parts[parts.length - 1], 10);
  if (isNaN(bg)) return null;
  // Standard terminal color indices: 0-6 are dark, 7+ are light
  // 0=black, 1=red, 2=green, 3=yellow(brown), 4=blue, 5=magenta, 6=cyan
  // 7=white, 8=bright black(gray), 9-14=bright colors, 15=bright white
  return bg >= 7 && bg !== 8 ? 'light' : 'dark';
}

/**
 * Attempt to detect terminal theme via OSC 11 escape sequence.
 * Writes query to stdout, reads response from stdin with a timeout.
 */
export function detectViaOsc11(timeoutMs: number = 200): Promise<ThemeMode | null> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let responded = false;
    let buf = '';

    const timer = setTimeout(() => {
      if (!responded) {
        responded = true;
        cleanup();
        resolve(null);
      }
    }, timeoutMs);

    function cleanup(): void {
      stdin.removeListener('data', onData);
      if (wasRaw !== undefined && stdin.setRawMode) {
        try { stdin.setRawMode(wasRaw); } catch {}
      }
    }

    function onData(chunk: Buffer | string): void {
      buf += chunk.toString();
      const result = parseOsc11Response(buf);
      if (result !== null || buf.includes('\x07') || buf.includes('\x1b\\')) {
        if (!responded) {
          responded = true;
          clearTimeout(timer);
          cleanup();
          resolve(result);
        }
      }
    }

    try {
      if (stdin.setRawMode) stdin.setRawMode(true);
      stdin.on('data', onData);
      // OSC 11 query: request background color
      process.stdout.write('\x1b]11;?\x07');
    } catch {
      if (!responded) {
        responded = true;
        clearTimeout(timer);
        resolve(null);
      }
    }
  });
}

/**
 * Detect the terminal theme.
 * If setting is 'light' or 'dark', returns it directly.
 * If 'auto', tries OSC 11, then COLORFGBG, then defaults to 'dark'.
 */
export async function detectTheme(setting: 'auto' | 'light' | 'dark'): Promise<ThemeMode> {
  if (setting === 'light' || setting === 'dark') return setting;

  // Try OSC 11 detection (only in TTY)
  if (process.stdin.isTTY) {
    const osc = await detectViaOsc11();
    if (osc) return osc;
  }

  // Fallback to COLORFGBG
  const colorfgbg = parseColorfgbg(process.env.COLORFGBG);
  if (colorfgbg) return colorfgbg;

  return 'dark';
}

/**
 * Returns the appropriate color palette for the given mode.
 * Respects the NO_COLOR environment variable.
 */
export function getPalette(mode: ThemeMode): ColorPalette {
  if (process.env.NO_COLOR !== undefined) return NO_COLOR_PALETTE;
  return mode === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

// --- Module singleton ---

let activePalette: ColorPalette = DARK_PALETTE;

export function setActivePalette(palette: ColorPalette): void {
  activePalette = palette;
}

export function getActivePalette(): ColorPalette {
  return activePalette;
}
