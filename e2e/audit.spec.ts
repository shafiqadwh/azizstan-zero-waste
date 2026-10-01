import { expect, test, type Page } from '@playwright/test';
import { createTestUser } from './db';

/** T29: the audit log viewer (12-security §2 item 8) — staff read it, filters live in the URL, teachers stay out. */

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('an executive reads the audit log and filters it by actor and entity', async ({ page }) => {
  const exec = await createTestUser({ role: 'executive', password: 'exec-password' });
  await signIn(page, exec, 'exec-password'); // writes user.login for this user
  await page.goto('/admin');
  await page.getByRole('link', { name: 'ประวัติการทำรายการ' }).click();
  await expect(page.getByRole('heading', { name: 'ประวัติการทำรายการ' })).toBeVisible();
  await page.getByLabel('ผู้ทำรายการ').fill(exec);
  await page.getByLabel('ประเภท').selectOption('user');
  await page.getByRole('button', { name: 'ค้นหา' }).click();
  await expect(page).toHaveURL(new RegExp(`actor=${exec}`));
  const rows = page.getByTestId('audit-rows');
  await expect(rows).toContainText('user.login');
  await expect(rows.locator('li')).toHaveCount(1);
  // no way to change anything from here
  await expect(page.getByRole('button', { name: /ลบ|แก้ไข/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('a teacher cannot open the audit log', async ({ page }) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await signIn(page, teacher, 'teacher-password');
  await page.goto('/admin/audit');
  await expect(page).not.toHaveURL(/\/admin\/audit/);
});
