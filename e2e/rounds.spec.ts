import { expect, test, type Page } from '@playwright/test';
import { createTestUser, seedCommitteeFixture, seedOpenRound } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('admin gives a class with no building its building for the round (BR-R4)', async ({ page }) => {
  const { termId, building, className } = await seedCommitteeFixture();
  const roundId = await seedOpenRound(termId);
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto(`/admin/settings/rounds/${roundId}`);
  await expect(page.getByRole('heading', { name: 'อาคารของห้องเรียน · รอบที่ 1' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  const row = page.getByTestId(`round-class-${className}`);
  await expect(row).toContainText('ไม่มีพื้นที่');
  await expect(page.getByText('ไม่มีพื้นที่ 1 ห้องเรียน · ต้องกำหนดก่อนปิดรอบ')).toBeVisible();
  await row.getByLabel(`พื้นที่ของ ${className}`).selectOption({ label: building });
  await row.getByRole('button', { name: 'บันทึก' }).click();
  await expect(row.getByText('บันทึกแล้ว')).toBeVisible();
  await expect(row).not.toContainText('ไม่มีพื้นที่');
  await page.reload();
  await expect(row.getByLabel(`พื้นที่ของ ${className}`)).toHaveValue(/.+/);
  await expect(page.getByText(/ไม่มีพื้นที่ \d+ ห้องเรียน/)).toHaveCount(0);
});

test('executive sees the round areas read-only', async ({ page }) => {
  const { termId, className } = await seedCommitteeFixture();
  const roundId = await seedOpenRound(termId);
  const exec = await createTestUser({ role: 'executive', password: 'exec-password' });
  await signIn(page, exec, 'exec-password');
  await page.goto(`/admin/settings/rounds/${roundId}`);
  await expect(page.getByText('โหมดดูอย่างเดียว')).toBeVisible();
  await expect(page.getByTestId(`round-class-${className}`)).toContainText('ไม่มีพื้นที่');
  await expect(page.getByRole('button', { name: 'บันทึก' })).toHaveCount(0);
});
