import { z } from 'zod';

import { isHexColor, readableTextColor } from './branding';

/**
 * Per-element color palette for a published surface (form, landing page,
 * in-app message, on-site widget). A creator may theme four roles, and every
 * value is re-validated as a `#hex` literal before it ever reaches a `style=`,
 * so a palette can never carry injected markup. New surfaces seed their palette
 * from the org brand color; existing rows store `null` and fall back at render.
 *
 * All defaulting, validation, and contrast logic lives here — the one place it
 * gets real unit coverage — and is shared by every surface's editor and render.
 */

export const PALETTE_KEYS = ['background', 'text', 'button', 'accent'] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type SurfacePalette = Record<PaletteKey, string>;

// Neutral page defaults; the brand color drives the interactive roles.
const DEFAULT_BACKGROUND = '#ffffff';
const DEFAULT_TEXT = '#0a0a0a';
// Matches the app's stock `--primary` (indigo-500) when no brand color is set.
const DEFAULT_BRAND = '#6366f1';

/** A valid brand color, or the stock fallback when unset/invalid. */
function safeBrand(brandColor?: string | null): string {
  return brandColor && isHexColor(brandColor) ? brandColor : DEFAULT_BRAND;
}

/** The palette a new surface starts from, seeded from the org brand color. */
export function defaultPalette(brandColor?: string | null): SurfacePalette {
  const brand = safeBrand(brandColor);
  return { background: DEFAULT_BACKGROUND, text: DEFAULT_TEXT, button: brand, accent: brand };
}

const hexColor = z.string().refine(isHexColor, { message: 'must be a #rgb or #rrggbb color' });

/** Validates a full palette coming from an editor (all four roles, all hex). */
export const surfacePaletteSchema = z.object({
  background: hexColor,
  text: hexColor,
  button: hexColor,
  accent: hexColor,
}) satisfies z.ZodType<SurfacePalette>;

/**
 * Coerce a stored palette (Prisma `Json`, possibly `null`, partial, or holding
 * a stale/invalid value) into a complete, validated palette — falling back to
 * the brand-seeded default per field. This is the server-side re-validation
 * gate: callers pass the result straight to inline styles.
 */
export function resolvePalette(stored: unknown, brandColor?: string | null): SurfacePalette {
  const base = defaultPalette(brandColor);
  if (!stored || typeof stored !== 'object') return base;
  const record = stored as Record<string, unknown>;
  const resolved = { ...base };
  for (const key of PALETTE_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && isHexColor(value)) resolved[key] = value;
  }
  return resolved;
}

/**
 * The design-system CSS custom properties a React public render sets on its
 * wrapper so the shared shadcn components (card, button) adopt the palette.
 * Button text is derived for legible contrast. Values are hex literals only.
 */
export function paletteSurfaceVars(palette: SurfacePalette): Record<string, string> {
  return {
    '--background': palette.background,
    '--card': palette.background,
    '--foreground': palette.text,
    '--card-foreground': palette.text,
    '--primary': palette.button,
    '--primary-foreground': readableTextColor(palette.button),
    '--accent': palette.accent,
    '--ring': palette.accent,
  };
}
