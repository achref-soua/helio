'use client';

import { isHexColor, PALETTE_KEYS, type SurfacePalette } from '@helio/core';
import { Input } from '@helio/ui/components/input';
import { Label } from '@helio/ui/components/label';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

/** Native `<input type="color">` needs `#rrggbb`; expand short hex, else black. */
function toSixHex(hex: string): string {
  if (!isHexColor(hex)) return '#000000';
  const raw = hex.slice(1);
  return raw.length === 3
    ? `#${raw
        .split('')
        .map((c) => c + c)
        .join('')}`
    : hex;
}

/** A single color role: a native picker swatch beside a free-text hex input. */
export function ColorField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  testId?: string;
}) {
  const id = useId();
  const valid = isHexColor(value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          // Distinct from the text input's label so the two controls don't
          // collide by accessible name (the picker is a secondary affordance).
          aria-label={`${label} picker`}
          value={toSixHex(value)}
          onChange={(event) => onChange(event.target.value)}
          className="border-input size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!valid}
          className="font-mono"
          data-testid={testId}
        />
      </div>
    </div>
  );
}

/**
 * The four-role palette editor (background / text / button / accent), reused by
 * every surface's editor. Emits a complete palette on each change; the server
 * re-validates every value with `surfacePaletteSchema` before it is stored.
 */
export function PaletteFields({
  value,
  onChange,
}: {
  value: SurfacePalette;
  onChange: (next: SurfacePalette) => void;
}) {
  const t = useTranslations('palette');
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="palette-fields">
      {PALETTE_KEYS.map((key) => (
        <ColorField
          key={key}
          label={t(key)}
          value={value[key]}
          onChange={(next) => onChange({ ...value, [key]: next })}
          testId={`palette-field-${key}`}
        />
      ))}
    </div>
  );
}
