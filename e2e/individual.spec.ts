import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createTestUser, seedJourneyFixture, seedRoster, setRoomMode, unlockActiveTerm } from './db';

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
  await setRoomMode('group');
  await unlockActiveTerm();
});

test('T40 individual mode: per-student scores by code only, class mean, detail table', async ({ page }) => {
  test.setTimeout(90_000);
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);
  const tag = randomBytes(2).toString('hex');
  const codes = [`7${tag}01`, `7${tag}02`, `7${tag}03`];
  await seedRoster(f, codes);
  await setRoomMode('individual');

  await signIn(page, teacher, 'teacher-password');
  await page.goto('/tasks');
  await page.getByTestId(`task-${f.roomNumber}`).click();
  const card = page.locator('#card-studentScores');
  await expect(card).toContainText('รายคน · เต็ม 5');
  for (const code of codes) await expect(card).toContainText(code);
  await expect(page.getByText(/ชื่อลับ/)).toHaveCount(0); // names never reach the page (FR-S1)
  await expect(page.getByTestId('students-filled')).toHaveText('ใส่แล้ว 0 / 3 คน');

  const submit = page.getByRole('button', { name: 'บันทึกและส่งให้ Admin อนุมัติ' });
  await submit.click();
  await expect(card.getByRole('alert')).toHaveText('ยังไม่ได้ให้คะแนนนักเรียนอีก 3 คน');

  await page.getByRole('combobox', { name: `คะแนนนักเรียนรหัส ${codes[0]}` }).selectOption('3000');
  await page.getByLabel('ใส่ให้คนที่ยังว่าง').selectOption('4000');
  await page.getByRole('button', { name: 'ใส่ 2 คน' }).click();
  await expect(page.getByTestId('students-filled')).toHaveText('ใส่แล้ว 3 / 3 คน');
  await expect(card).toContainText('เฉลี่ยห้อง 3.67');

  await page.locator('#site-photos').setInputFiles([await jpeg('#3a7'), await jpeg('#a73'), await jpeg('#37a')]);
  await page.locator('#signature-photo').setInputFiles(await jpeg('#eee'));
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await page.waitForURL(/\/tasks\?saved=1/);
  await unlockActiveTerm();

  await page.getByRole('tab', { name: /รออนุมัติ/ }).click();
  await page.getByTestId(`task-${f.roomNumber}`).click();
  await expect(page.getByTestId('detail-score')).toContainText('3.67');
  await expect(page.getByText('เฉลี่ยห้องจากคะแนนรายคน')).toBeVisible();
  await page.getByText('คะแนนรายคน (3 คน)').click();
  const table = page.getByTestId('student-scores');
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('row', { name: new RegExp(`${codes[0]}\\s+3`) })).toBeVisible();
  await expect(table.getByRole('row', { name: new RegExp(`${codes[2]}\\s+4`) })).toBeVisible();
  await expect(page.getByText(/ชื่อลับ/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
