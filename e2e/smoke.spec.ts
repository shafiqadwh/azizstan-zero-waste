import { expect, test } from '@playwright/test';

test('home renders with IBM Plex Sans Thai and no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AZIZSTAN Zero Waste');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');

  const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(fontFamily).toMatch(/plex/i);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].some((f) => f.status === 'loaded'));
  expect(loaded).toBe(true);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
