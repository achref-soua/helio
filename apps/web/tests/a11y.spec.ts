import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// WCAG 2.2 AA regression gate: axe-core over the pages that exercise the
// design system's risky surfaces (badges, tables, forms, section text).
// Serious/critical violations fail the suite — the bar the README claims.

const PAGES = ['/', '/contacts', '/tasks', '/segments', '/settings', '/login'];

for (const path of PAGES) {
  test(`axe: ${path} has no serious or critical violations`, async ({ page }) => {
    await page.goto(path);
    // Settle hydration and the first data paint before scanning.
    await page.waitForLoadState('networkidle');
    // The sunrise splash self-unmounts; axe audits the steady-state page,
    // not a frame blended mid-fade (where contrast is legitimately low).
    await expect(page.getByTestId('sun-splash')).toHaveCount(0, { timeout: 6_000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
      blocking.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
      })),
    ).toEqual([]);
  });
}
