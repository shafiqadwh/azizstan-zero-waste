import { expect, test, type Page } from '@playwright/test';
import { createTestUser } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('installed app has no browser back: every page below home has ย้อนกลับ and หน้าหลัก', async ({ page }) => {
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');

  // home: no back row
  await page.goto('/admin');
  await expect(page.getByRole('button', { name: 'ย้อนกลับ' })).toHaveCount(0);

  // navigated inside the app: back returns to the previous page
  await page.getByRole('link', { name: 'ภาคเรียน', exact: true }).click();
  await page.waitForURL(/\/admin\/settings\/term$/);
  await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
  await page.waitForURL(/\/admin$/);

  // opened directly (bookmark, notification, QR): back goes home instead of leaving the app
  await page.goto('/admin/settings/classes');
  await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
  await page.waitForURL(/\/admin$/);

  // the wordmark and หน้าหลัก both lead home
  await page.goto('/admin/audit');
  await page.getByRole('navigation', { name: 'การนำทาง' }).getByRole('link', { name: 'หน้าหลัก' }).click();
  await page.waitForURL(/\/admin$/);
});
