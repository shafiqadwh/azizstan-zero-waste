import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createTestUser, ensureActiveTerm, unlockActiveTerm } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

const rand = () => randomBytes(3).toString('hex').toUpperCase();

async function addClass(page: Page, name: string) {
  const details = page.locator('details', { has: page.getByText('+ เพิ่มห้องเรียน') });
  if ((await details.getAttribute('open')) === null) await page.getByText('+ เพิ่มห้องเรียน').click();
  await page.getByLabel('รหัสระดับชั้น').fill('E2E');
  await page.getByLabel('ระดับชั้น', { exact: true }).fill('ม.E');
  await page.getByLabel('กลุ่มจัดอันดับ').fill('ม.E');
  await page.getByLabel('ชื่อห้องเรียน').fill(name);
  await page.getByRole('button', { name: 'เพิ่มห้องเรียน' }).click();
  await expect(page.getByTestId(`class-ม.E ${name}`)).toBeVisible();
}

test('admin adds buildings and classes, and gives each class of the term its building', async ({ page }) => {
  test.setTimeout(60_000);
  await ensureActiveTerm();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/settings/classes');
  await expect(page.getByRole('heading', { name: 'ห้องเรียนและอาคาร' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  // rooms moved to the facilities system: no room register, no door QR
  await expect(page.getByText('+ เพิ่มห้อง', { exact: true })).toHaveCount(0);
  await expect(page.getByText('พิมพ์ QR ทุกห้อง')).toHaveCount(0);
  expect((await page.request.get('/api/v1/templates/rooms.xlsx')).status()).toBe(404);

  const b = `E${rand()}`.slice(0, 6);
  await page.getByLabel('รหัสอาคาร').fill(b);
  await page.getByRole('button', { name: '+ เพิ่มอาคาร' }).click();
  await expect(page.getByText(`เพิ่มอาคาร ${b} แล้ว`)).toBeVisible();

  const c1 = `Alpha${rand()}`;
  await addClass(page, c1);

  // the term selection card saves (FR-P7) with the class's building (FR-P4). Other specs submit evaluations in
  // the shared active term, which locks its config (BR-TM2), so unlock and retry until this save lands between them.
  const card = page.getByRole('region', { name: /ห้องเรียนที่ใช้ใน/ });
  await expect(async () => {
    await unlockActiveTerm();
    await page.reload();
    await card.getByRole('checkbox', { name: `ม.E ${c1}` }).check({ timeout: 2000 });
    await card.getByLabel(`อาคารของ ม.E ${c1}`).selectOption({ label: `อาคาร ${b}` });
    await card.getByRole('button', { name: 'บันทึกห้องเรียนที่ใช้' }).click();
    await expect(card.getByRole('status')).toContainText('บันทึกแล้ว', { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await page.reload();
  await expect(card.getByLabel(`อาคารของ ม.E ${c1}`)).toHaveValue(/[0-9a-f-]{36}/);
  await expect(card.getByLabel(`อาคารของ ม.E ${c1}`).locator('option:checked')).toHaveText(`อาคาร ${b}`);

  // aliases still work on the class register
  const row = page.getByTestId(`class-ม.E ${c1}`);
  await row.getByText('เพิ่มชื่อเรียกอื่น').click();
  await row.getByLabel('ชื่อในข้อมูลนักเรียน (ชื่อเรียกอื่น)').fill(`ม.E/9 ${c1}`);
  await row.getByRole('button', { name: 'เพิ่ม', exact: true }).click();
  await expect(row.getByRole('status')).toContainText('เพิ่มชื่อเรียกแล้ว');

  // duties.xlsx template downloads for admins
  const tpl = await page.request.get('/api/v1/templates/duties.xlsx');
  expect(tpl.status()).toBe(200);
});

test('an executive sees the register read-only', async ({ page }) => {
  await ensureActiveTerm();
  const exec = await createTestUser({ role: 'executive', password: 'exec-password' });
  await signIn(page, exec, 'exec-password');
  await page.goto('/admin/settings/classes');
  await expect(page.getByRole('note')).toContainText('โหมดดูอย่างเดียว');
  await expect(page.getByRole('button', { name: '+ เพิ่มอาคาร' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'บันทึกห้องเรียนที่ใช้' })).toHaveCount(0);
});
