/** True for a `#rgb` or `#rrggbb` hex color string. */
export function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function channels(hex: string): [number, number, number] {
  const raw = hex.slice(1);
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * A legible text color — near-black or white — to place on top of `hex`,
 * chosen by WCAG relative luminance. Used to derive `--primary-foreground`
 * for a white-label accent. Returns near-black for invalid input.
 */
export function readableTextColor(hex: string): '#0a0a0a' | '#ffffff' {
  if (!isHexColor(hex)) return '#0a0a0a';
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#0a0a0a' : '#ffffff';
}
