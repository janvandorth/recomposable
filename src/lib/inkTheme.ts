import { createContext, useContext } from 'react';
import type { ThemeMode } from './theme.js';

export interface InkPalette {
  mode: ThemeMode;
  green: string;
  yellow: string;
  red: string;
  gray: string;
  cyan: string;
  magenta: string;
  logo: string;
  dim: string;
  highlightBg: string;
}

export const DARK_INK_PALETTE: InkPalette = {
  mode: 'dark',
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  gray: 'gray',
  cyan: 'cyan',
  magenta: 'magenta',
  logo: 'cyan',
  dim: '#bcbcbc',    // 250
  highlightBg: '#444444', // 238
};

export const LIGHT_INK_PALETTE: InkPalette = {
  mode: 'light',
  green: 'green',
  yellow: 'yellow',
  red: 'red',
  gray: 'gray',
  cyan: 'cyan',
  magenta: 'magenta',
  logo: '',
  dim: '#6c6c6c',    // 242
  highlightBg: '#e4e4e4', // 254
};

export function getInkPalette(mode: ThemeMode): InkPalette {
  return mode === 'light' ? LIGHT_INK_PALETTE : DARK_INK_PALETTE;
}

export const ThemeContext = createContext<InkPalette>(DARK_INK_PALETTE);

export function useTheme(): InkPalette {
  return useContext(ThemeContext);
}
