import { createHmac } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

// TOTP enrollment and challenge, end to end on a dedicated user: enable in
// Settings (QR + backup codes + first verification), sign back in through
// the /two-factor challenge with a real RFC-6238 code, burn a backup code,
// then disable. A fresh user keeps the shared storage-state account clean
// for every other spec.

const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? '8025'}`;
const PASSWORD = 'correct-horse-battery';

test.use({ storageState: { cookies: [], origins: [] } });

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238, SHA-1, 30s step, 6 digits — Better-Auth's TOTP defaults. */
function totp(secretBase32: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('enroll in TOTP 2FA, sign in through the challenge, burn a backup code, disable', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const email = `twofa-${Date.now()}@example.com`;

  // 1. A dedicated verified user with their own org (mirrors auth.setup).
  await page.goto('/signup');
  await page.getByLabel('Name').fill('TwoFA Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = await request.get(`${MAILPIT}/api/v1/search?query=to:${email}`);
        const { messages } = (await list.json()) as { messages: Array<{ ID: string }> };
        if (!messages?.length) return false;
        const message = await request.get(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
        const { Text } = (await message.json()) as { Text: string };
        link = Text.match(/https?:\/\/\S+verify-email\S+/)?.[0];
        return Boolean(link);
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  await page.goto(link!);
  await expect(page.getByText('Create your organization')).toBeVisible();
  // Unique per attempt: a slow first attempt can create the org server-side
  // even when the dashboard handoff misses its window, and a fixed name
  // would then dead-end every retry on the taken slug.
  await page.getByLabel('Organization name').fill(`TwoFA Org ${Date.now()}`);
  await page.evaluate(() => localStorage.setItem('helio.tour.v1.done', '1'));
  await page.getByRole('button', { name: 'Create organization' }).click();
  // A cold org's first dashboard render takes a while under suite load —
  // same allowance as the rotation spec's identical transition.
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });

  // 2. Enable 2FA from Settings: password → QR/secret + backup codes →
  //    verify a real code (activation happens only after this verifies).
  await page.goto('/settings');
  await expect(page.getByTestId('security-panel')).toBeVisible();
  await page.getByTestId('twofa-enable').click();
  await page.getByTestId('twofa-password').fill(PASSWORD);
  await page.getByTestId('twofa-continue').click();

  await expect(page.getByTestId('twofa-qr')).toBeVisible();
  const totpUri = (await page.getByTestId('twofa-uri').textContent()) ?? '';
  const secret = new URL(totpUri).searchParams.get('secret');
  expect(secret, 'totp uri must carry the shared secret').toBeTruthy();

  const backupCodes = await page
    .getByTestId('twofa-backup-codes')
    .locator('span')
    .allTextContents();
  expect(backupCodes.length).toBeGreaterThan(0);

  await page.getByTestId('twofa-code').fill(totp(secret!));
  await page.getByTestId('twofa-verify').click();
  await expect(page.getByTestId('twofa-enabled-badge')).toBeVisible();

  // 3. Sign out; signing back in must route through the challenge.
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await login(page, email);
  await expect(page).toHaveURL(/\/two-factor/);
  await page.getByTestId('twofa-challenge-code').fill(totp(secret!));
  await page.getByTestId('twofa-challenge-verify').click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // 4. Sign out again and use a single-use backup code instead.
  await page.getByRole('button', { name: 'Open user menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await login(page, email);
  await expect(page).toHaveURL(/\/two-factor/);
  await page.getByTestId('twofa-use-backup').click();
  await page.getByTestId('twofa-challenge-code').fill(backupCodes[0]!);
  await page.getByTestId('twofa-challenge-verify').click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // 5. Disable and confirm the badge is gone.
  await page.goto('/settings');
  await page.getByTestId('twofa-disable').click();
  await page.getByTestId('twofa-password').fill(PASSWORD);
  await page.getByTestId('twofa-continue').click();
  await expect(page.getByTestId('twofa-enabled-badge')).toHaveCount(0);
  await expect(page.getByTestId('twofa-enable')).toBeVisible();
});
