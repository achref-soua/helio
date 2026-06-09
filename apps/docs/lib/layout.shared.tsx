import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Shared options for every Fumadocs layout — the nav title and the GitHub link.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <span aria-hidden>☀️</span>
          <span className="font-medium">Helio</span>
        </>
      ),
    },
    githubUrl: 'https://github.com/achref-soua/helio',
  };
}
