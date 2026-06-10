import type { Locator } from '@playwright/test';

/**
 * Pick an option from the app's themed (Radix) select: open the trigger,
 * then click the option in the portaled listbox. String names match
 * exactly — several operator labels are substrings of each other.
 */
export async function pickOption(trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  await trigger
    .page()
    .getByRole('option', { name: option, exact: typeof option === 'string' })
    .click();
}
