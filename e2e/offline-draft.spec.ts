import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { createTestUser, seedJourneyFixture, unlockActiveTerm } from './db';

const jpeg = async (color: string) =>
  ({
    name: `${color.slice(1)}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
      .jpeg()
      .toBuffer(),
  }) as const;

test('offline draft: survives a reload, queues photos offline and sends itself when the signal returns', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const { roomNumber } = await seedJourneyFixture(teacher);
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(teacher);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill('teacher-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');

  await page.goto('/tasks');
  await page.getByTestId(`task-${roomNumber}`).click();
  await expect(page.getByTestId('target-header')).toContainText(roomNumber);

  // 1) what was entered is stored on the phone and comes back after a reload
  await page.getByRole('group', { name: 'เลือกคะแนน' }).getByRole('button', { name: '4', exact: true }).click();
  await page.getByRole('textbox', { name: 'คำแนะนำและข้อติชม' }).fill('ร่างจากหน้างาน');
  await page.locator('#site-photos').setInputFiles(await jpeg('#3a7'));
  await expect(page.getByRole('img', { name: 'รูปที่ 1' })).toBeVisible();
  await expect(page.locator('#card-sitePhotos').getByRole('status')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(800); // draft writes are debounced
  page.once('dialog', (d) => void d.accept());
  await page.reload();
  await expect(page.getByText(/กู้คืนร่างที่บันทึกไว้ในเครื่องเมื่อ/)).toBeVisible();
  await expect(page.getByTestId('score-value')).toHaveText('4');
  await expect(page.getByRole('textbox', { name: 'คำแนะนำและข้อติชม' })).toHaveValue('ร่างจากหน้างาน');
  await expect(page.locator('#card-sitePhotos')).toContainText('1 / 5');

  // 2) the signal drops: banner, photos wait, submit is queued
  await context.setOffline(true);
  await expect(page.getByText('ออฟไลน์ — ข้อมูลจะถูกส่งเมื่อมีสัญญาณ')).toBeVisible();
  await page.locator('#site-photos').setInputFiles([await jpeg('#a73'), await jpeg('#37a')]);
  await page.locator('#signature-photo').setInputFiles(await jpeg('#eee'));
  await expect(page.getByText('รอสัญญาณ')).toHaveCount(3, { timeout: 20_000 });
  await expect(page.locator('#card-sitePhotos')).toContainText('3 / 5');
  await page.getByRole('button', { name: 'บันทึกและส่งให้ Admin อนุมัติ' }).click();
  const queued = page.getByRole('button', { name: 'จะส่งเมื่อมีสัญญาณ' });
  await expect(queued).toBeDisabled();
  await page.waitForTimeout(800);
  expect(page.url()).toContain('/evaluate/new');

  // 3) the signal returns: photos upload, the evaluation sends itself, the draft is gone
  await context.setOffline(false);
  await page.waitForURL(/\/tasks\?saved=1/, { timeout: 60_000 });
  await unlockActiveTerm(); // the shared active term must stay editable for other specs
  await expect(page.getByText('ส่งแล้ว รออนุมัติ')).toBeVisible();
  const drafts = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('zw-offline', 1);
        req.onsuccess = () => {
          const c = req.result.transaction('drafts').objectStore('drafts').count();
          c.onsuccess = () => resolve(c.result);
        };
      }),
  );
  expect(drafts).toBe(0);
  await page.getByRole('tab', { name: /รออนุมัติ/ }).click();
  await page.getByTestId(`task-${roomNumber}`).click();
  await expect(page.getByTestId('detail-score')).toContainText('4');
  await expect(page.getByRole('link', { name: /ดูรูปที่/ })).toHaveCount(4);
});
