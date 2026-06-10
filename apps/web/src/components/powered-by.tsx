import { getTranslations } from 'next-intl/server';

/**
 * Attribution footer for the hosted public pages (forms, landing pages,
 * booking). Orgs that white-label (a brand name or logo is set) get a
 * clean page with no Helio mention.
 */
export async function PoweredBy({ whiteLabeled }: { whiteLabeled: boolean }) {
  if (whiteLabeled) return null;
  const t = await getTranslations('publicFooter');
  return (
    <footer className="py-5 text-center">
      <a
        href="https://github.com/achref-soua/helio"
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground text-xs transition-colors"
      >
        {t('poweredBy')}
      </a>
    </footer>
  );
}
