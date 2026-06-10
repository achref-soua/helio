import { expect, test } from '@playwright/test';

// Regression: personalization help text contains literal {{token}} braces.
// next-intl is an ICU formatter, so an unescaped `{{` is parsed as a
// malformed argument and the UI silently shows fallback text instead of the
// copy. The braces must be ICU-escaped ('{{'…'}}') in messages/en.json.
test('the email editor shows literal personalization tokens, not i18n fallbacks', async ({
  page,
}) => {
  const i18nErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /INVALID_MESSAGE|MALFORMED_ARGUMENT/.test(message.text())) {
      i18nErrors.push(message.text());
    }
  });

  await page.goto('/emails');
  await page.getByRole('button', { name: 'New template' }).click();

  // The subtitle and the personalization hint render the literal tokens.
  await expect(page.getByText('personalize with {{tokens}}')).toBeVisible();
  await expect(page.getByText(/Personalization: \{\{firstName\}\}/)).toBeVisible();

  expect(i18nErrors, `unescaped ICU tokens leaked: ${i18nErrors.join(' | ')}`).toEqual([]);
});
