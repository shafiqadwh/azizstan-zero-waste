import { expect, test } from '@playwright/test';
import { createTestUser, seedJourneyFixture } from './db';

test('room hub: anyone scanning sees the room and the three services; a committee member logs in and evaluates', async ({
  page,
}) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);

  // signed out: room, class, building/floor, a login button that comes back here
  await page.goto(`/r/${f.qrToken}`);
  const header = page.getByTestId('room-hub-header');
  await expect(header).toContainText(f.roomNumber);
  await expect(header).toContainText(f.className);
  await expect(header).toContainText('ชั้น 2');
  await expect(page.getByTestId('service-cleanliness')).toContainText('ประเมินความสะอาด');
  await expect(page.getByTestId('service-it')).toContainText('เปิดให้บริการเร็ว ๆ นี้');
  await expect(page.getByTestId('service-facility')).toContainText('เปิดให้บริการเร็ว ๆ นี้');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name: 'กรรมการ: เข้าสู่ระบบเพื่อประเมิน' }).click();
  await page.getByLabel('ชื่อผู้ใช้').fill(teacher);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('teacher-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL(new RegExp(`/r/${f.qrToken}$`));

  // signed in with a duty on the class: straight to the form
  await page.getByRole('link', { name: 'ประเมินห้องนี้' }).click();
  await page.waitForURL(/\/evaluate\/new/);
  await expect(page.getByTestId('target-header')).toContainText(f.roomNumber);
});

test('room hub: a signed-in user without a task is told so; an unknown QR is a 404', async ({ page }) => {
  const committee = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(committee);
  const other = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(other);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('teacher-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');

  await page.goto(`/r/${f.qrToken}`);
  await expect(page.getByTestId('service-cleanliness')).toContainText(
    'ห้องนี้ไม่อยู่ในรายการที่คุณต้องประเมินในรอบนี้',
  );
  expect((await page.goto('/r/not-a-real-token-123'))?.status()).toBe(404);
});
