import { isHexColor, readableTextColor } from '@helio/core';

/**
 * Apply a white-label accent as CSS-variable overrides on `:root`. The color
 * is re-validated here, so it can only ever be a `#hex` literal — the inline
 * <style> can't carry injected markup. Renders nothing when unset/invalid.
 */
export function BrandStyle({ color }: { color?: string | null }) {
  if (!color || !isHexColor(color)) return null;
  const foreground = readableTextColor(color);
  const css = `:root{--primary:${color};--primary-foreground:${foreground};--ring:${color};}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
