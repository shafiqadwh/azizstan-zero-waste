import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createTestUser, ensureActiveTerm } from './db';

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

async function move(page: Page, className: string, room: string, date: string) {
  const row = page.getByTestId(`class-ม.E ${className}`);
  const summary = row.getByText('ย้ายห้อง / เพิ่มชื่อเรียกอื่น');
  if (
    !(await row
      .locator('details')
      .getAttribute('open')
      .then((v) => v !== null))
  )
    await summary.click();
  await row.getByLabel('ย้ายไปห้อง').selectOption({ label: room });
  await row.getByLabel('มีผลตั้งแต่วันที่').fill(date);
  await row.getByRole('button', { name: 'ย้ายห้อง', exact: true }).click();
  return row;
}

test('admin registers rooms and classes, moves a class, and gets Thai overlap errors', async ({ page }) => {
  await ensureActiveTerm();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/settings/classes');
  await expect(page.getByRole('heading', { name: 'ห้องเรียน อาคาร และหมายเลขห้อง' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  const b = `E${rand()}`.slice(0, 6);
  const [roomA, roomB] = [`A${rand()}`, `B${rand()}`];
  await page.getByLabel('รหัสอาคาร').fill(b);
  await page.getByRole('button', { name: '+ เพิ่มอาคาร' }).click();
  await expect(page.getByText(`เพิ่มอาคาร ${b} แล้ว`)).toBeVisible();
  for (const r of [roomA, roomB]) {
    await page.getByLabel('อาคาร', { exact: true }).selectOption({ label: `อาคาร ${b}` });
    await page.getByLabel('หมายเลขห้อง', { exact: true }).fill(r);
    await page.getByRole('button', { name: '+ เพิ่มห้อง' }).click();
    await expect(page.getByText(`เพิ่มห้อง ${r} แล้ว`)).toBeVisible();
  }

  const c1 = `Alpha${rand()}`;
  const c2 = `Beta${rand()}`;
  await addClass(page, c1);
  await addClass(page, c2);

  let row = await move(page, c1, roomA, '2026-11-01');
  await expect(row.getByRole('status')).toContainText('ย้ายห้องแล้ว');
  row = await move(page, c1, roomB, '2026-12-15');
  await expect(row.getByRole('status')).toContainText('ย้ายห้องแล้ว');
  await expect(row).toContainText(`เข้าห้อง ${roomA} ตั้งแต่ 1 พ.ย. 2569`);

  // roomA is taken by c1 until 15 Dec: c2 cannot move in on 20 Nov
  row = await move(page, c2, roomA, '2026-11-20');
  await expect(row.getByRole('alert')).toContainText(`ห้อง ${roomA} มี ม.E ${c1} ใช้อยู่ในวันที่นั้น`);

  // the term selection card saves (FR-P7)
  const card = page.getByRole('region', { name: /ห้องเรียนที่ใช้ใน/ });
  await card.getByLabel(`ม.E ${c1}`).check();
  await card.getByRole('button', { name: 'บันทึกห้องเรียนที่ใช้' }).click();
  await expect(card.getByRole('status')).toContainText('บันทึกแล้ว');

  // rooms.xlsx template downloads for admins
  const tpl = await page.request.get('/api/v1/templates/rooms.xlsx');
  expect(tpl.status()).toBe(200);
  expect(tpl.headers()['content-type']).toContain('spreadsheetml');
});

test('an executive sees the register read-only', async ({ page }) => {
  await ensureActiveTerm();
  const exec = await createTestUser({ role: 'executive', password: 'exec-password' });
  await signIn(page, exec, 'exec-password');
  await page.goto('/admin/settings/classes');
  await expect(page.getByRole('note')).toContainText('โหมดดูอย่างเดียว');
  await expect(page.getByRole('button', { name: '+ เพิ่มอาคาร' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'บันทึกห้องเรียนที่ใช้' })).toHaveCount(0);
  expect((await page.request.get('/api/v1/templates/rooms.xlsx')).status()).toBe(403);
});
