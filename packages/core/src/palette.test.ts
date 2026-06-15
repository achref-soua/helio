import { describe, expect, it } from 'vitest';

import {
  defaultPalette,
  PALETTE_KEYS,
  paletteSurfaceVars,
  resolvePalette,
  surfacePaletteSchema,
} from './palette';

describe('defaultPalette', () => {
  it('seeds the interactive roles from a valid brand color', () => {
    const palette = defaultPalette('#ff8800');
    expect(palette).toEqual({
      background: '#ffffff',
      text: '#0a0a0a',
      button: '#ff8800',
      accent: '#ff8800',
    });
  });

  it('falls back to the stock brand when the color is missing or invalid', () => {
    expect(defaultPalette(null).button).toBe('#6366f1');
    expect(defaultPalette('not-a-color').accent).toBe('#6366f1');
    expect(defaultPalette(undefined).button).toBe('#6366f1');
  });
});

describe('resolvePalette', () => {
  it('returns the brand default when nothing is stored', () => {
    expect(resolvePalette(null, '#123456')).toEqual(defaultPalette('#123456'));
    expect(resolvePalette(undefined, '#123456')).toEqual(defaultPalette('#123456'));
  });

  it('overlays stored values on the default, per field', () => {
    const palette = resolvePalette({ background: '#000000', button: '#abcdef' }, '#123456');
    expect(palette.background).toBe('#000000');
    expect(palette.button).toBe('#abcdef');
    // Untouched roles keep the brand-seeded default.
    expect(palette.accent).toBe('#123456');
    expect(palette.text).toBe('#0a0a0a');
  });

  it('drops invalid or non-string stored values back to the default', () => {
    const palette = resolvePalette({ background: 'red', text: 42, button: '#fff' }, '#123456');
    expect(palette.background).toBe('#ffffff'); // 'red' is not a #hex
    expect(palette.text).toBe('#0a0a0a'); // 42 is not a string
    expect(palette.button).toBe('#fff'); // valid short hex kept
  });

  it('ignores non-object input', () => {
    expect(resolvePalette('nope', '#123456')).toEqual(defaultPalette('#123456'));
    expect(resolvePalette(123, '#123456')).toEqual(defaultPalette('#123456'));
  });
});

describe('surfacePaletteSchema', () => {
  it('accepts a full palette of hex colors', () => {
    const value = { background: '#fff', text: '#000000', button: '#6366f1', accent: '#abc' };
    expect(surfacePaletteSchema.parse(value)).toEqual(value);
  });

  it('rejects a non-hex value', () => {
    expect(
      surfacePaletteSchema.safeParse({
        background: 'white',
        text: '#000',
        button: '#000',
        accent: '#000',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing role', () => {
    expect(surfacePaletteSchema.safeParse({ background: '#fff' }).success).toBe(false);
  });

  it('covers every declared palette key', () => {
    expect(Object.keys(surfacePaletteSchema.shape).sort()).toEqual([...PALETTE_KEYS].sort());
  });
});

describe('paletteSurfaceVars', () => {
  it('maps the palette to design-system tokens and derives button text', () => {
    const vars = paletteSurfaceVars({
      background: '#ffffff',
      text: '#0a0a0a',
      button: '#000000',
      accent: '#ff0000',
    });
    expect(vars['--background']).toBe('#ffffff');
    expect(vars['--foreground']).toBe('#0a0a0a');
    expect(vars['--primary']).toBe('#000000');
    // Black button → white text for contrast.
    expect(vars['--primary-foreground']).toBe('#ffffff');
    expect(vars['--accent']).toBe('#ff0000');
    expect(vars['--ring']).toBe('#ff0000');
  });
});
