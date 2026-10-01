import { expect, test, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createTestUser, seedJourneyFixture, seedOldEvaluation, unlockActiveTerm } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function adminPage(browser: Browser) {
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, admin, 'admin-password');
  return { page, close: () => ctx.close() };
}

const jpeg = async () => ({
  name: 'p.jpg',
  mimeType: 'image/jpeg',
  buffer: await sharp({ create: { width: 800, height: 600, channels: 3, background: '#4a7' } })
    .jpeg()
    .toBuffer(),
});

test('journey 3: after close the form asks for approval; admin grants 24 h; the form opens and submits', async ({
  page,
  browser,
}) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher, { closedRound: true });
  await signIn(page, teacher, 'teacher-password');
  const formUrl = `/evaluate/new?round=${f.roundId}&component=${f.componentId}&target=class:${f.classId}`;
  await page.goto(formUrl);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('เลยกำหนดใส่คะแนนแล้ว กด "ขออนุมัติใส่คะแนน"');
  await page.getByLabel('เหตุผล').fill('ป่วยในวันที่ประเมิน');
  await page.getByRole('button', { name: 'ขออนุมัติใส่คะแนน' }).click();
  await expect(page.getByText(/รอพิจารณาคำขอ/)).toBeVisible();

  const admin = await adminPage(browser);
  await admin.page.goto('/admin/approvals?tab=requests');
  const card = admin.page.getByTestId(`request-${f.className}`);
  await expect(card).toContainText('ขอใส่คะแนนหลังกำหนด');
  await expect(card).toContainText('ป่วยในวันที่ประเมิน');
  await card.getByRole('combobox').selectOption('24');
  await card.getByRole('button', { name: 'อนุมัติการแก้ไข' }).click();
  await expect(card).toHaveCount(0); // decided requests leave the waiting list
  await admin.close();

  await page.goto(formUrl);
  await page.getByRole('group', { name: 'เลือกคะแนน' }).getByRole('button', { name: '4', exact: true }).click();
  await page.locator('#site-photos').setInputFiles([await jpeg(), await jpeg(), await jpeg()]);
  await page.locator('#signature-photo').setInputFiles(await jpeg());
  const submit = page.getByRole('button', { name: 'บันทึกและส่งให้ Admin อนุมัติ' });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await page.waitForURL(/\/tasks\?saved=1/);
  await unlockActiveTerm();
  await expect(page.getByText('ส่งแล้ว รออนุมัติ')).toBeVisible();
});

test('journey 4: after 24 h the owner asks to change 4.5 → 3; admin sees old/new and approves', async ({
  page,
  browser,
}) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);
  const evaluationId = await seedOldEvaluation(f);
  await signIn(page, teacher, 'teacher-password');
  await page.goto(`/evaluate/${evaluationId}`);
  await expect(page.getByTestId('detail-score')).toContainText('4.5');
  await expect(page.getByRole('link', { name: 'แก้ไข', exact: true })).toHaveCount(0); // window passed
  await page.getByRole('button', { name: 'ขออนุมัติแก้ไข' }).click();
  const sheet = page.getByRole('region', { name: 'ขออนุมัติแก้ไข' });
  await sheet.getByLabel('แก้คะแนน').check();
  await sheet.getByRole('group', { name: 'เลือกคะแนน' }).getByRole('button', { name: '3', exact: true }).click();
  await sheet.getByRole('button', { name: 'ส่งคำขอ' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
  await sheet.getByLabel('เหตุผล').fill('กดคะแนนผิดตอนประเมิน');
  await sheet.getByRole('button', { name: 'ส่งคำขอ' }).click();
  await expect(page.getByText('แก้คะแนน · รอพิจารณาคำขอ')).toBeVisible();

  const admin = await adminPage(browser);
  await admin.page.goto('/admin/approvals?tab=requests');
  const card = admin.page.getByTestId(`request-${f.className}`);
  await expect(card.getByTestId('request-change')).toHaveText('4.5 → 3');
  await card.getByRole('button', { name: 'อนุมัติการแก้ไข' }).click();
  await expect(card).toHaveCount(0); // decided requests leave the waiting list
  await admin.close();

  await page.reload();
  await expect(page.getByTestId('detail-score')).toContainText('3');
  await expect(page.getByText('แก้คะแนน · อนุมัติแล้ว')).toBeVisible();
});
