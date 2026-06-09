import { expect, test } from '@playwright/test';

// CRM-lite tasks: create a task, see it listed, complete it, then delete it —
// all keyboard-accessible (icon buttons carry explicit aria-labels).

test('tasks appears in the primary navigation', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Tasks' }),
  ).toBeVisible();
});

test('create a task, complete it, then delete it', async ({ page }) => {
  await page.goto('/tasks');

  await page.getByTestId('new-task').click();
  await page.getByLabel('Title').fill('Email the Q3 recap');
  await page.getByLabel('Priority').selectOption({ label: 'High' });
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();

  const row = page.getByTestId('task-row').filter({ hasText: 'Email the Q3 recap' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('High');

  // Complete it; the row's toggle flips to "Reopen".
  await row.getByRole('button', { name: 'Mark Email the Q3 recap done' }).click();
  const doneRow = page.getByTestId('task-row').filter({ hasText: 'Email the Q3 recap' });
  await expect(doneRow.getByRole('button', { name: 'Reopen Email the Q3 recap' })).toBeVisible();

  // Delete it.
  await doneRow.getByRole('button', { name: 'Delete Email the Q3 recap' }).click();
  await expect(page.getByText('Task deleted')).toBeVisible();
  await expect(page.getByTestId('task-row').filter({ hasText: 'Email the Q3 recap' })).toHaveCount(
    0,
  );
});
