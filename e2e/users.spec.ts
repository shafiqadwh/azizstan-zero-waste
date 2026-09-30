import { expect, test, type Page } from '@playwright/test';
import { createTestUser } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('super admin creates a user; the temporary password works once and must be changed', async ({ page, browser }) => {
  const root = await createTestUser({ role: 'super_admin', password: 'root-password' });
  await signIn(page, root, 'root-password');
  await page.getByRole('link', { name: 'ผู้ใช้และสิทธิ์' }).click();
  await expect(page.getByRole('heading', { name: 'ผู้ใช้และสิทธิ์' })).toBeVisible();
  // works at 360 px and 1440 px: no horizontal scroll (AGENTS §7)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  const newName = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const form = page.getByRole('region', { name: 'เพิ่มผู้ใช้' });
  await form.getByLabel('ชื่อผู้ใช้').fill(newName);
  await form.getByLabel('ชื่อที่แสดง').fill('ครูทดสอบใหม่');
  await form.getByLabel('สิทธิ์').selectOption('teacher');
  await form.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();

  const temp = (await page.getByTestId('temp-password').textContent())!.trim();
  expect(temp).toMatch(/^[a-zA-Z2-9]{10}$/);
  await expect(page.getByTestId(`user-${newName}`)).toContainText('ครูทดสอบใหม่');

  const other = await browser.newPage();
  await signIn(other, newName, temp);
  await expect(other).toHaveURL(/\/account\/password/);
  await other.close();
});

test('an admin sees a read-only list without management controls', async ({ page }) => {
  const adminUser = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, adminUser, 'admin-password');
  await page.goto('/admin/settings/users');
  await expect(page.getByRole('note')).toContainText('โหมดดูอย่างเดียว');
  await expect(page.getByRole('region', { name: 'เพิ่มผู้ใช้' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'บันทึกสิทธิ์' })).toHaveCount(0);
  await expect(page.getByTestId(`user-${adminUser}`)).toBeVisible();
});
