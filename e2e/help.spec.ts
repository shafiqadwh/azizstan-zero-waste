import { expect, test, type Page } from '@playwright/test';
import { createTestUser, seedJourneyFixture } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('manuals: a committee member reads the committee manual only; staff also get the admin manual', async ({
  page,
  browser,
}) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await seedJourneyFixture(teacher);
  await signIn(page, teacher, 'teacher-password');
  await page.goto('/tasks');
  await page.getByRole('link', { name: 'คู่มือ', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'คู่มือ', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /คู่มือกรรมการและครูผู้รับผิดชอบพื้นที่/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /คู่มือผู้ดูแลระบบ/ })).toHaveCount(0);
  await page.getByRole('link', { name: /คู่มือกรรมการและครูผู้รับผิดชอบพื้นที่/ }).click();
  await expect(page.getByRole('heading', { name: 'สัญญาณอ่อนหรือไม่มีเน็ต' })).toBeVisible();
  expect((await page.goto('/help/admin-manual'))?.status()).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  const adminPage = await browser.newPage();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(adminPage, admin, 'admin-password');
  await adminPage.goto('/help/admin-manual');
  await expect(adminPage.getByRole('heading', { name: 'อนุมัติอัตโนมัติ' })).toBeVisible();
  await adminPage.close();

  // the public committee guide now names the real buttons (0008 refreshed the untouched default)
  await page.goto('/guide/committee-guide');
  await expect(page.getByText('ขออนุมัติแก้ไข')).toBeVisible();
});
