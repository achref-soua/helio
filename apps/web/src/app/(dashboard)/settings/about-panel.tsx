import { healthPayload, isNewerHelioVersion } from '@helio/core';
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
 * One anonymous, cached read of the public releases feed — nothing about
 * this deployment is sent. Failures (offline, rate-limited) stay quiet.
 */
async function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const response = await fetch('https://api.github.com/repos/achref-soua/helio/releases/latest', {
      headers: { accept: 'application/vnd.github+json' },
      next: { revalidate: 21_600 },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as { tag_name?: string; html_url?: string };
    return release.tag_name && release.html_url
      ? { version: release.tag_name, url: release.html_url }
      : null;
  } catch {
    return null;
  }
}

export async function AboutPanel() {
  const t = await getTranslations('about');
  const { version, commit } = healthPayload('web');
  // Source checkouts ("dev") have nothing meaningful to compare against.
  const checkEnabled = process.env.HELIO_UPDATE_CHECK !== 'false' && version !== 'dev';
  const latest = checkEnabled ? await fetchLatestRelease() : null;
  const update = latest && isNewerHelioVersion(latest.version, version) ? latest : null;

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
        {update ? (
          <p>
            <a
              className="text-primary font-medium underline underline-offset-4"
              href={update.url}
              target="_blank"
              rel="noreferrer"
            >
              {t('updateAvailable', { version: update.version })}
            </a>
          </p>
        ) : latest ? (
          <p className="text-muted-foreground">{t('upToDate')}</p>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{t('license')}</span>
          <span>AGPL-3.0</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <a
            className="text-primary underline underline-offset-4"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t('repo')}
          </a>
          <a
            className="text-primary underline underline-offset-4"
            href={`${REPO_URL}/releases`}
            target="_blank"
            rel="noreferrer"
          >
            {t('releases')}
          </a>
          <a
            className="text-primary underline underline-offset-4"
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
