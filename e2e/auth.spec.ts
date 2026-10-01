import { expect, test, type Page } from '@playwright/test';
import { createTestUser } from './db';

async function fillLogin(page: Page, username: string, password: string) {
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  // wait for the server action round-trip so repeated identical errors are not matched early
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/login'),
    page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click(),
  ]);
}

const formAlert = (page: Page) => page.locator('form').getByRole('alert');

test('signed-in pages send anonymous visitors to the login page', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible();
});

test('first login forces a password change, then lands on the dashboard; logout ends the session', async ({ page }) => {
  const username = await createTestUser({ role: 'admin', password: 'first-password', mustChange: true });
  await page.goto('/login');
  await fillLogin(page, username, 'first-password');

  await expect(page).toHaveURL(/\/account\/password\?next=%2Fadmin$/);
  // the dashboard is not reachable until the password is changed
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/account\/password/);

  await page.getByLabel('รหัสผ่านปัจจุบัน').fill('first-password');
  await page.getByLabel('รหัสผ่านใหม่', { exact: true }).fill('second-password');
  await page.getByLabel('ยืนยันรหัสผ่านใหม่').fill('second-password');
  await page.getByRole('button', { name: 'บันทึกรหัสผ่านใหม่' }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'ภาพรวม' })).toBeVisible();

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('the 6th attempt after 5 wrong passwords is rate limited', async ({ page }) => {
  const username = await createTestUser({ role: 'admin', password: 'right-password' });
  await page.goto('/login');
  for (let i = 0; i < 5; i++) {
    await fillLogin(page, username, `wrong-password-${i}`);
    await expect(formAlert(page)).toHaveText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    // React resets the form after a failed action; wait for it so the next fill is not wiped by a late reset
    await expect(page.getByLabel('รหัสผ่าน', { exact: true })).toHaveValue('');
  }
  await fillLogin(page, username, 'right-password');
  await expect(formAlert(page)).toHaveText('ลองใหม่อีกครั้งในอีกสักครู่');
  await expect(page).toHaveURL(/\/login$/);
});

test('a teacher without a duty sees the no-assignment message and cannot open the admin area', async ({ page }) => {
  const username = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await page.goto('/login');
  await fillLogin(page, username, 'teacher-password');
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('คุณยังไม่ได้รับมอบหมายให้ประเมินในเทอมนี้')).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/tasks$/);
});
