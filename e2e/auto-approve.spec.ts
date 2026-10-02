import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createTestUser, seedJourneyFixture, setAutoApprove, unlockActiveTerm } from './db';

const jpeg = async (color: string) =>
  ({
    name: `${color.slice(1)}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  }) as const;

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test.afterAll(async () => {
  await setAutoApprove(false);
  await unlockActiveTerm();
});

test('อนุมัติอัตโนมัติ: the admin switches it on; a saved evaluation is approved at once and still editable', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher); // also makes sure the active term exists
  const adminPage = await browser.newPage();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(adminPage, admin, 'admin-password');
  await adminPage.goto('/admin/settings/mode');
  const toggle = adminPage.getByRole('switch', { name: 'อนุมัติอัตโนมัติ' });
  await expect(toggle).toBeEnabled(); // not affected by the config lock
  if (!(await toggle.isChecked())) await toggle.click();
  await expect(adminPage.getByText('เปิดอนุมัติอัตโนมัติแล้ว')).toBeVisible();
  await adminPage.goto('/admin/approvals');
  await expect(adminPage.getByRole('switch', { name: 'อนุมัติอัตโนมัติ' })).toBeChecked();

  await signIn(page, teacher, 'teacher-password');
  await page.goto('/tasks');
  await page.getByTestId(`task-${f.roomNumber}`).click();
  await page.getByRole('group', { name: 'เลือกคะแนน' }).getByRole('button', { name: '4', exact: true }).click();
  await page.locator('#site-photos').setInputFiles([await jpeg('#3a7'), await jpeg('#a73'), await jpeg('#37a')]);
  await page.locator('#signature-photo').setInputFiles(await jpeg('#eee'));
  const save = page.getByRole('button', { name: 'บันทึกผลประเมิน' });
  await expect(save).toBeEnabled({ timeout: 20_000 });
  await save.click();
  await page.waitForURL(/\/tasks\?saved=auto/);
  await unlockActiveTerm();
  await expect(page.getByText('บันทึกแล้ว อนุมัติอัตโนมัติ')).toBeVisible();

  await page.getByRole('tab', { name: /เสร็จ/ }).click();
  await page.getByTestId(`task-${f.roomNumber}`).click();
  await expect(page.getByText('อนุมัติแล้ว').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'แก้ไข', exact: true })).toBeVisible();
  await expect(page.getByText(/แก้ไขเองได้อีก \d+ ชม\./)).toBeVisible();

  // nothing is left for the admin to approve for this class
  await adminPage.reload();
  await expect(adminPage.getByTestId(`result-${f.className}`)).toHaveCount(0);
  await adminPage.close();
});
