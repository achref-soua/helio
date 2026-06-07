/* eslint-disable no-console -- operator-facing script */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { chromium } from '@playwright/test';

/**
 * Regenerates the README/docs screenshots from a running app so they never
 * go stale: `task up && task dev` (or a deployed URL via BASE_URL), then
 * `task screenshots`. Authenticated captures (dashboard, journey canvas)
 * join the set once the demo seed includes a login — tracked for Phase 1.
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.resolve(import.meta.dirname, '../../../docs/assets');

const SHOTS: Array<{ name: string; route: string; theme?: 'dark' }> = [
  { name: 'login', route: '/login' },
  { name: 'login-dark', route: '/login', theme: 'dark' },
  { name: 'signup', route: '/signup' },
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  for (const shot of SHOTS) {
    await page.goto(`${BASE_URL}${shot.route}`);
    if (shot.theme === 'dark') {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
    }
    await page.waitForLoadState('networkidle');
    const file = path.join(OUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`captured ${file}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
