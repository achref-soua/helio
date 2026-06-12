'use client';

import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import { useTranslations } from 'next-intl';

zxcvbnOptions.setOptions({
  dictionary: common.dictionary,
  graphs: common.adjacencyGraphs,
});

/**
 * Live password-strength meter (M1). Guidance, not gatekeeping beyond
 * score 2 — the forms disable submit below it, and the server keeps its
 * own minimum length regardless of what a client claims.
 */
export function passwordScore(password: string): number {
  if (!password) return 0;
  return zxcvbn(password).score;
}

const TONE = ['bg-destructive', 'bg-destructive', 'bg-amber-500', 'bg-green-500', 'bg-green-600'];

export function PasswordStrength({ password }: { password: string }) {
  const t = useTranslations('auth.strength');
  if (!password) return null;
  const score = passwordScore(password);
  return (
    <div className="grid gap-1" data-testid="password-strength" data-score={score}>
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded ${score > step ? TONE[score] : 'bg-muted'}`}
          />
        ))}
      </div>
      <p className="text-muted-foreground text-xs">{t(`score${score}`)}</p>
    </div>
  );
}
