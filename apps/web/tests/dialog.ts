import { expect, type Locator } from '@playwright/test';

/**
 * Open a panel dialog/menu robustly.
 *
 * The /settings panels are code-split, so a panel's button is server-rendered
 * and clickable before its chunk has loaded and React has attached the click
 * handler. A single `.click()` in that window is a no-op and the dialog never
 * opens — the classic "Playwright clicks before hydration" race. This retries
 * the trigger click until the dialog's first element appears (within the test
 * timeout, by which point the chunk has loaded), and never double-clicks an
 * already-open dialog.
 */
export async function openDialog(trigger: Locator, appears: Locator): Promise<void> {
  await expect(async () => {
    if (!(await appears.isVisible())) {
      await trigger.click({ timeout: 2_000 });
    }
    await expect(appears).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Fill a controlled input robustly. Same hydration race: a value typed before
 * the panel's chunk has hydrated lands in the DOM but not in React state, and
 * React resets the input to its initial value when it hydrates — so the value
 * is silently lost. Re-fill until it sticks (the post-hydration fill holds).
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 500 });
  }).toPass({ timeout: 30_000 });
}

/**
 * Toggle a switch and wait for its effect (e.g. a save toast). Same hydration
 * race, but `.check()` is idempotent — a no-op when the DOM already shows
 * checked — so a single retry can't re-fire React's onChange. Force a real
 * transition (uncheck → check) each attempt until the effect appears.
 */
export async function checkUntil(toggle: Locator, appears: Locator): Promise<void> {
  await expect(async () => {
    if (!(await appears.isVisible())) {
      if (await toggle.isChecked()) await toggle.uncheck();
      await toggle.check();
    }
    await expect(appears).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
}
