import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createTestUser, seedJourneyFixture, unlockActiveTerm } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

const jpeg = async (color: string) =>
  ({
    name: `${color.slice(1)}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width: 1200, height: 900, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  }) as const;

const noHorizontalScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('journey 1: committee scores a room with photos and a signature sheet → รออนุมัติ', async ({ page }) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const { roomNumber, className } = await seedJourneyFixture(teacher);
  await signIn(page, teacher, 'teacher-password');
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'งานของฉัน' })).toBeVisible();
  await expect(page.getByText(/รอบที่ 1 · เหลือเวลาลงคะแนน/)).toBeVisible();
  await noHorizontalScroll(page);

  // search by class name, then open the class
  await page.getByPlaceholder('ชื่อห้องเรียน เช่น Amanah').fill(className);
  const row = page.getByTestId(`task-${roomNumber}`);
  await expect(row).toContainText(`${roomNumber} · ${className}`);
  await expect(row).toContainText('ยังไม่ประเมิน');
  await row.click();
  await expect(page.getByTestId('target-header')).toContainText(roomNumber);
  await expect(page.getByTestId('target-header')).toContainText(className);
  await noHorizontalScroll(page);

  const submit = page.getByRole('button', { name: 'บันทึกและส่งให้ Admin อนุมัติ' });
  // every validation message appears under its own card (08-ux-ui §9)
  await submit.click();
  await expect(page.locator('#card-score').getByRole('alert')).toHaveText(
    'กรุณาเลือกคะแนน (ถ้าไม่ให้คะแนน ให้เลือก 0)',
  );

  await page.getByRole('group', { name: 'เลือกคะแนน' }).getByRole('button', { name: '4', exact: true }).click();
  await expect(page.getByTestId('score-value')).toHaveText('4');
  await submit.click();
  await expect(page.locator('#card-sitePhotos').getByRole('alert')).toHaveText('ต้องถ่ายรูปอีก 3 รูป');

  await page.locator('#site-photos').setInputFiles([await jpeg('#3a7'), await jpeg('#a73'), await jpeg('#37a')]);
  await expect(page.locator('#card-sitePhotos')).toContainText('3 / 5');
  await expect(page.getByRole('button', { name: 'บันทึกและส่งให้ Admin อนุมัติ' })).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await expect(page.locator('#card-signature').getByRole('alert')).toHaveText('กรุณาถ่ายรูปใบลงชื่อนักเรียน');

  await page.locator('#signature-photo').setInputFiles(await jpeg('#eee'));
  await page.getByRole('textbox', { name: 'คำแนะนำและข้อติชม' }).fill('ห้องสะอาด จัดโต๊ะเรียบร้อย');
  await expect(page.locator('#card-comment')).toContainText('26/300');
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();

  await page.waitForURL(/\/tasks\?saved=1/);
  await unlockActiveTerm(); // the shared active term must stay editable for other specs
  await expect(page.getByText('ส่งแล้ว รออนุมัติ')).toBeVisible();
  await page.getByRole('tab', { name: /รออนุมัติ/ }).click();
  const done = page.getByTestId(`task-${roomNumber}`);
  await expect(done).toContainText('รออนุมัติ');

  // the detail shows the score, 4 photos and the owner's edit window
  await done.click();
  await expect(page.getByTestId('detail-score')).toContainText('4');
  await expect(page.getByRole('link', { name: /ดูรูปที่/ })).toHaveCount(4);
  await expect(page.getByText(/แก้ไขเองได้อีก \d+ ชม\./)).toBeVisible();
  await noHorizontalScroll(page);
});
