import ExcelJS from 'exceljs';
import { expect, test, type Page } from '@playwright/test';
import { createTestUser, seedCommitteeFixture } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function assign(page: Page, username: string, target: string) {
  await page.getByLabel('ค้นหาชื่อ').fill(username);
  await page.getByLabel(/^ผู้ใช้ \(/).selectOption({ index: 0 });
  await page.getByLabel('ห้องเรียนหรือพื้นที่').selectOption({ label: target });
  await page.getByRole('button', { name: 'มอบหมาย', exact: true }).click();
  await expect(page.getByText('มอบหมายแล้ว')).toBeVisible();
}

test('admin assigns committee, sees 0 / 2+ coverage, removes, and dry-runs duties.xlsx', async ({ page }) => {
  const { termId, building, className } = await seedCommitteeFixture();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  const t1 = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const t2 = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto(`/admin/settings/committee?term=${termId}`);
  await expect(page.getByRole('heading', { name: 'คณะกรรมการ', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  const cls = page.getByTestId(`target-${className}`);
  const bld = page.getByTestId(`target-${building}`);
  await expect(cls).toContainText('ยังไม่มีผู้ประเมิน');
  await expect(bld).toContainText('ยังไม่มีผู้ประเมิน');

  await assign(page, t1, className);
  await expect(cls).toContainText('ผู้ทดสอบ teacher');
  await expect(cls).not.toContainText('ยังไม่มีผู้ประเมิน');
  await assign(page, t2, className);
  await expect(cls).toContainText('มีผู้ประเมินซ้ำ');

  // the same duty twice is refused in Thai
  await page.getByLabel('ค้นหาชื่อ').fill(t1);
  await page.getByLabel('ห้องเรียนหรือพื้นที่').selectOption({ label: className });
  await page.getByRole('button', { name: 'มอบหมาย', exact: true }).click();
  await expect(page.getByText('มอบหมายหน้าที่นี้ให้ผู้ใช้คนนี้แล้ว')).toBeVisible();

  await cls
    .getByRole('button', { name: `นำ ผู้ทดสอบ teacher ออกจาก ${className}` })
    .first()
    .click();
  await expect(cls).not.toContainText('มีผู้ประเมินซ้ำ');

  // duties.xlsx dry-run: unknown username and unknown target are listed, nothing saved
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('duties');
  ws.addRow(['username', 'ชื่อ', 'หน้าที่', 'ประเภทเป้าหมาย', 'เป้าหมาย']);
  ws.addRow(['nobody.e2e', '', 'committee', 'ห้อง', className]);
  ws.addRow([t1, '', 'committee', 'อาคาร', 'ไม่มีอาคารนี้']);
  await page.getByLabel('ไฟล์ duties.xlsx').setInputFiles({
    name: 'duties.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(await wb.xlsx.writeBuffer()),
  });
  await page.getByRole('button', { name: 'ตรวจสอบไฟล์ (ยังไม่บันทึก)' }).click();
  await expect(page.getByText('พบ 2 แถวที่ผิด ยังไม่ได้นำเข้า')).toBeVisible();
  await expect(page.getByText('ไม่พบผู้ใช้ "nobody.e2e"')).toBeVisible();
  await expect(page.getByText('ไม่พบเป้าหมาย "ไม่มีอาคารนี้"')).toBeVisible();
  await expect(page.getByText(new RegExp(`ยังไม่มีผู้ประเมิน \\d+ รายการ: .*${building}`))).toBeVisible();
  await expect(page.getByRole('button', { name: 'ยืนยันนำเข้า' })).toHaveCount(0);
});

test('executive sees coverage read-only', async ({ page }) => {
  const { termId, className } = await seedCommitteeFixture();
  const exec = await createTestUser({ role: 'executive', password: 'exec-password' });
  await signIn(page, exec, 'exec-password');
  await page.goto(`/admin/settings/committee?term=${termId}`);
  await expect(page.getByText('โหมดดูอย่างเดียว')).toBeVisible();
  await expect(page.getByTestId(`target-${className}`)).toContainText('ยังไม่มีผู้ประเมิน');
  await expect(page.getByRole('button', { name: 'มอบหมาย', exact: true })).toHaveCount(0);
});
