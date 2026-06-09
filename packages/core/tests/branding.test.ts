import { describe, expect, it } from 'vitest';

import { isHexColor, readableTextColor } from '../src/branding';

describe('isHexColor', () => {
  it('accepts #rgb and #rrggbb', () => {
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#1d4ed8')).toBe(true);
    expect(isHexColor('#ABCDEF')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isHexColor('1d4ed8')).toBe(false);
    expect(isHexColor('#12')).toBe(false);
    expect(isHexColor('#1234')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#gggggg')).toBe(false);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
  });
});

describe('readableTextColor', () => {
  it('puts dark text on light backgrounds and white text on dark ones', () => {
    expect(readableTextColor('#ffffff')).toBe('#0a0a0a');
    expect(readableTextColor('#fde047')).toBe('#0a0a0a'); // light yellow
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#1d4ed8')).toBe('#ffffff'); // dark blue
  });

  it('falls back to dark text for invalid input', () => {
    expect(readableTextColor('not-a-color')).toBe('#0a0a0a');
  });
});
