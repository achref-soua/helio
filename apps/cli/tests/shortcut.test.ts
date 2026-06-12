import { describe, expect, it } from 'vitest';

import { ICON_PNG_BASE64 } from '../src/lib/icon-data';
import { pngToIco } from '../src/lib/shortcut';

describe('pngToIco', () => {
  const png = Buffer.from(ICON_PNG_BASE64, 'base64');

  it('wraps the embedded png as a single-image ico', () => {
    const ico = pngToIco(png, 180);
    // ICONDIR: reserved 0, type 1 (icon), one image.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    // ICONDIRENTRY: 180×180, image bytes and offset right where headers end.
    expect(ico.readUInt8(6)).toBe(180);
    expect(ico.readUInt8(7)).toBe(180);
    expect(ico.readUInt32LE(14)).toBe(png.length);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.length).toBe(22 + png.length);
    // The payload really is the PNG, byte for byte.
    expect(ico.subarray(22, 30)).toEqual(png.subarray(0, 8));
  });

  it('marks 256px (and larger) images with the 0 sentinel', () => {
    const ico = pngToIco(png, 256);
    expect(ico.readUInt8(6)).toBe(0);
    expect(ico.readUInt8(7)).toBe(0);
  });

  it('embeds a real png', () => {
    // PNG magic: 89 50 4E 47.
    expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
