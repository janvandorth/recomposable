import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseOsc11Response,
  parseColorfgbg,
  getPalette,
  DARK_PALETTE,
  LIGHT_PALETTE,
  NO_COLOR_PALETTE,
  setActivePalette,
  getActivePalette,
} from '../src/lib/theme';

describe('parseOsc11Response', () => {
  it('detects dark background from 4-digit hex', () => {
    expect(parseOsc11Response('\x1b]11;rgb:0000/0000/0000\x07')).toBe('dark');
  });

  it('detects light background from 4-digit hex', () => {
    expect(parseOsc11Response('\x1b]11;rgb:ffff/ffff/ffff\x07')).toBe('light');
  });

  it('detects dark background from 2-digit hex', () => {
    expect(parseOsc11Response('\x1b]11;rgb:1a/1a/1a\x07')).toBe('dark');
  });

  it('detects light background from 2-digit hex', () => {
    expect(parseOsc11Response('\x1b]11;rgb:ee/ee/ee\x07')).toBe('light');
  });

  it('handles ST terminator (ESC backslash)', () => {
    expect(parseOsc11Response('\x1b]11;rgb:ffff/ffff/ffff\x1b\\')).toBe('light');
  });

  it('returns null for invalid input', () => {
    expect(parseOsc11Response('')).toBe(null);
    expect(parseOsc11Response('garbage')).toBe(null);
  });

  it('detects Dracula-like dark theme', () => {
    // Dracula background: #282a36 → rgb:2828/2a2a/3636
    expect(parseOsc11Response('\x1b]11;rgb:2828/2a2a/3636\x07')).toBe('dark');
  });

  it('detects Catppuccin Latte light theme', () => {
    // Catppuccin Latte background: #eff1f5 → rgb:efef/f1f1/f5f5
    expect(parseOsc11Response('\x1b]11;rgb:efef/f1f1/f5f5\x07')).toBe('light');
  });
});

describe('parseColorfgbg', () => {
  it('returns dark for black background (0)', () => {
    expect(parseColorfgbg('15;0')).toBe('dark');
  });

  it('returns light for white background (7)', () => {
    expect(parseColorfgbg('0;7')).toBe('light');
  });

  it('returns light for bright white background (15)', () => {
    expect(parseColorfgbg('0;15')).toBe('light');
  });

  it('returns dark for bright black/gray background (8)', () => {
    expect(parseColorfgbg('15;8')).toBe('dark');
  });

  it('handles 3-part format (fg;extra;bg)', () => {
    expect(parseColorfgbg('15;default;0')).toBe('dark');
    expect(parseColorfgbg('0;default;15')).toBe('light');
  });

  it('returns null for undefined', () => {
    expect(parseColorfgbg(undefined)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(parseColorfgbg('')).toBe(null);
  });

  it('returns null for non-numeric', () => {
    expect(parseColorfgbg('abc')).toBe(null);
  });
});

describe('getPalette', () => {
  const origNoColor = process.env.NO_COLOR;

  afterEach(() => {
    if (origNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = origNoColor;
    }
  });

  it('returns DARK_PALETTE for dark mode', () => {
    delete process.env.NO_COLOR;
    expect(getPalette('dark')).toBe(DARK_PALETTE);
  });

  it('returns LIGHT_PALETTE for light mode', () => {
    delete process.env.NO_COLOR;
    expect(getPalette('light')).toBe(LIGHT_PALETTE);
  });

  it('returns NO_COLOR_PALETTE when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(getPalette('dark')).toBe(NO_COLOR_PALETTE);
    expect(getPalette('light')).toBe(NO_COLOR_PALETTE);
  });

  it('returns NO_COLOR_PALETTE when NO_COLOR is empty string', () => {
    process.env.NO_COLOR = '';
    expect(getPalette('dark')).toBe(NO_COLOR_PALETTE);
  });
});

describe('setActivePalette / getActivePalette', () => {
  it('defaults to DARK_PALETTE', () => {
    setActivePalette(DARK_PALETTE);
    expect(getActivePalette()).toBe(DARK_PALETTE);
  });

  it('can switch to LIGHT_PALETTE', () => {
    setActivePalette(LIGHT_PALETTE);
    expect(getActivePalette()).toBe(LIGHT_PALETTE);
    // Reset
    setActivePalette(DARK_PALETTE);
  });
});
