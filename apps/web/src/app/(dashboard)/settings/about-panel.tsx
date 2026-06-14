import { healthPayload } from '@helio/core';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@helio/ui/components/card';
import { getTranslations } from 'next-intl/server';

const REPO_URL = 'https://github.com/achref-soua/helio';

/**
 * Deployment identity for support and debugging. Update availability and the
 * one-click update live in the Updates panel; this card stays static.
 */
export async function AboutPanel() {
  const t = await getTranslations('about');
  const { version, commit } = healthPayload('web');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('version')}</span>
          <span className="font-mono">
            {version === 'dev' ? t('devBuild') : `v${version}`}
            {commit ? ` · ${commit}` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('license')}</span>
          <span>AGPL-3.0</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <a
            className="text-foreground underline underline-offset-4"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t('repo')}
          </a>
          <a
            className="text-foreground underline underline-offset-4"
            href={`${REPO_URL}/releases`}
            target="_blank"
            rel="noreferrer"
          >
            {t('releases')}
          </a>
          <a
            className="text-foreground underline underline-offset-4"
            href={`${REPO_URL}/tree/main/apps/docs`}
            target="_blank"
            rel="noreferrer"
          >
            {t('docs')}
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
