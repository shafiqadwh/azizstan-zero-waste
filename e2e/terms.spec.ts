import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestUser, freeTermSlot } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('admin creates a term, sets the score format, rounds and per-round full marks', async ({ page }, info) => {
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  const slot = await freeTermSlot(info.project.name.includes('mobile') ? 1 : 0);

  // create from defaults
  await page.goto('/admin/settings/term');
  await page.getByLabel('ปีการศึกษา (พ.ศ.)').fill(String(slot.academicYear));
  await page.getByLabel('ภาคเรียน', { exact: true }).selectOption(String(slot.termNo));
  await page.getByLabel('คัดลอกการตั้งค่าจาก').selectOption({ label: 'ไม่คัดลอก (ใช้ค่าเริ่มต้น)' });
  await page.getByRole('button', { name: 'สร้างภาคเรียน' }).click();
  await expect(page.getByRole('status')).toContainText(`สร้างภาคเรียนที่ ${slot.termNo}/${slot.academicYear} แล้ว`);
  const row = page.getByTestId(`term-${slot.termNo}-${slot.academicYear}`);
  await expect(row).toContainText('ร่าง');

  // integer score format
  await row.getByRole('link', { name: 'รูปแบบการประเมิน' }).click();
  await page.waitForURL(/\/admin\/settings\/mode/);
  // a click that lands before hydration is lost, so repeat until React has seen it
  await expect(async () => {
    await page.getByLabel(/^จำนวนเต็ม/).check();
    await expect(page.getByLabel('ให้คะแนนทีละ')).toHaveCount(0, { timeout: 1000 }); // step only for decimals
  }).toPass();
  await page.getByRole('button', { name: 'บันทึกการตั้งค่า' }).click();
  await expect(page.getByRole('status')).toContainText('บันทึกการตั้งค่าแล้ว');

  // rounds stepper: 0 → 2
  await page.goto(page.url().replace('/mode', '/scoring'));
  await page.getByRole('button', { name: 'เพิ่มจำนวนรอบ' }).click();
  await expect(page.getByTestId('round-count')).toHaveText('1');
  await page.getByRole('button', { name: 'เพิ่มจำนวนรอบ' }).click();
  await expect(page.getByTestId('round-count')).toHaveText('2');
  await expect(page.getByText('รอบที่ 2', { exact: true })).toBeVisible();

  // default components: room 5 + building 10, teacher score off and not counted
  await expect(page.getByTestId('per-round-sum')).toHaveText('รวมต่อรอบ 15 คะแนน');

  // different full marks per round + a term maximum that differs → scaling note
  await page.getByRole('switch', { name: 'ใช้คะแนนเต็มเท่ากันทุกรอบ' }).uncheck();
  await page.getByLabel('คะแนนเต็มคะแนนอาคาร รอบที่ 2').fill('15');
  await page.getByLabel('คะแนนเต็มปลายภาคเรียน').fill('20');
  await expect(page.getByTestId('scaling-note')).toHaveText('คะแนนจะถูกแปลงเป็นเต็ม 20');
  await page.getByRole('button', { name: 'บันทึกส่วนคะแนน' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'บันทึกส่วนคะแนนแล้ว' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('switch', { name: 'ใช้คะแนนเต็มเท่ากันทุกรอบ' })).not.toBeChecked();
  await expect(page.getByLabel('คะแนนเต็มคะแนนอาคาร รอบที่ 2')).toHaveValue('15');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('an executive sees term settings read-only', async ({ page }) => {
  const exec = await createTestUser({ role: 'executive', password: 'exec-password' });
  await signIn(page, exec, 'exec-password');
  await page.goto('/admin/settings/term');
  await expect(page.getByRole('note')).toContainText('โหมดดูอย่างเดียว');
  await expect(page.getByRole('button', { name: 'สร้างภาคเรียน' })).toHaveCount(0);
});

test('closed term settings are read-only for an admin even without an evaluation lock', async ({ page }, info) => {
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  const slot = await freeTermSlot(info.project.name.includes('mobile') ? 1 : 0);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  let termId: string;
  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO terms (id, academic_year, term_no, status, area_type, final_max, closed_at, purge_after)
       VALUES (gen_random_uuid(), $1, $2, 'closed', 'building', 15, now(), current_date + 365) RETURNING id`,
      [slot.academicYear, slot.termNo],
    );
    termId = rows[0]!.id;
    await client.query(
      `INSERT INTO rounds (id, term_id, round_no, opens_at, closes_at)
       VALUES (gen_random_uuid(), $1, 1, now() + interval '1 day', now() + interval '5 days')`,
      [termId],
    );
  } finally {
    await client.end();
  }
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/settings/term');
  const row = page.getByTestId(`term-${slot.termNo}-${slot.academicYear}`);
  await expect(row).toContainText('ปิดแล้ว');
  await expect(row.getByRole('button')).toHaveCount(0);
  await page.goto(`/admin/settings/mode?term=${termId}`);
  await expect(page.getByRole('note')).toContainText('โหมดดูอย่างเดียว');
  await expect(page.getByLabel(/^จำนวนเต็ม/)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึกการตั้งค่า' })).toHaveCount(0);
  await page.goto(`/admin/settings/scoring?term=${termId}`);
  await expect(page.getByRole('note')).toContainText('โหมดดูอย่างเดียว');
  await expect(page.getByRole('button', { name: 'เพิ่มจำนวนรอบ' })).toBeDisabled();
  await expect(page.getByLabel('เปิดลงคะแนน', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('ปิดรับคะแนน', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'บันทึกวันที่' })).toHaveCount(0);
  await expect(page.getByLabel('คะแนนเต็มปลายภาคเรียน')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
