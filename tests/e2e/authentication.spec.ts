import { expect, test } from '@playwright/test';

test('redirects anonymous visitors to sign in', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page).toHaveTitle(/Sign in.*TradePlay/);
  await expect(page.getByRole('heading', { name: 'Sign in to TradePlay' })).toBeVisible();
});

test('registers, preserves the opening credit, signs out, and signs back in', async ({
  page,
}, testInfo) => {
  const email = `playwright-${testInfo.project.name}-${Date.now()}@example.com`;
  const password = 'tradeplay123';

  await page.goto('/sign-up');
  await page.getByLabel('Name').fill('Playwright Trader');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle(/Portfolios.*TradePlay/);
  await expect(page.getByText('Available cash').locator('..')).toContainText('₹50,000.00');
  await expect(page.getByText('Starting balance', { exact: true }).locator('..')).toContainText(
    '₹50,000.00',
  );
  await expect(page.getByText('Initial virtual cash credit')).toHaveCount(1);
  await expect(page.getByText('+₹50,000.00')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Initial virtual cash credit')).toHaveCount(1);
  await expect(page.getByText('+₹50,000.00')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Available cash').locator('..')).toContainText('₹50,000.00');
});
