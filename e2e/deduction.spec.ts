import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createTestUser, disableDeduction, seedDeduction, seedJourneyFixture, unlockActiveTerm } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test.afterAll(async () => {
  await disableDeduction();
  await unlockActiveTerm();
});

test('T41: the area teacher deducts once with a photo and a reason; the admin sees "−2" to approve', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const committee = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(committee);
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await seedDeduction(teacher, f.areaId);

  await signIn(page, teacher, 'teacher-password');
  await page.goto('/tasks');
  // deductions are optional: listed apart, never counted under "ต้องทำ"
  await expect(page.getByRole('tab', { name: /ต้องทำ/ })).toHaveText('ต้องทำ 0');
  await expect(page.getByRole('heading', { name: 'หักคะแนน (1)' })).toBeVisible();
  const row = page.getByTestId(`deduct-${f.roomNumber}`);
  await expect(row).toContainText('หักได้');
  await row.click();

  await expect(page.getByRole('heading', { name: 'หักคะแนน', exact: true })).toBeVisible();
  await expect(page.locator('#card-score')).toContainText('หักได้สูงสุด 3');
  await expect(page.locator('#card-signature')).toHaveCount(0);
  await page.getByRole('group', { name: 'เลือกคะแนน' }).getByRole('button', { name: '2', exact: true }).click();
  await page.locator('#site-photos').setInputFiles({
    name: 'bin.jpg',
    mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: '#a73' } })
      .jpeg()
      .toBuffer(),
  });
  const submit = page.getByRole('button', { name: 'บันทึกการหักคะแนนและส่งให้ Admin อนุมัติ' });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await expect(page.locator('#card-comment').getByRole('alert')).toHaveText(
    'กรุณาระบุเหตุผลที่หักคะแนนอย่างน้อย 5 ตัวอักษร',
  );
  await page.getByRole('textbox', { name: 'เหตุผลที่หักคะแนน (จำเป็น)' }).fill('ขยะล้นถังหน้าห้อง');
  await submit.click();
  await page.waitForURL(/\/tasks\?saved=1/);
  await unlockActiveTerm();

  await page.getByRole('tab', { name: /รออนุมัติ/ }).click();
  await page.getByTestId(`task-${f.roomNumber}`).click();
  await expect(page.getByTestId('detail-score')).toContainText('−2');
  await expect(page.getByText('เหตุผลที่หักคะแนน', { exact: true })).toBeVisible();
  await expect(page.getByText('ขยะล้นถังหน้าห้อง')).toBeVisible();

  const adminPage = await browser.newPage();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(adminPage, admin, 'admin-password');
  await adminPage.goto('/admin/approvals');
  const card = adminPage.getByTestId(`result-${f.className}`);
  await expect(card.getByTestId('result-score')).toContainText('−2');
  await expect(card).toContainText('หักได้สูงสุด 3');
  await adminPage.close();
});
