import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestUser, ensureActiveTerm } from './db';

/** T28: the privacy page (retention per term, archive downloads, last backup) and the ZIP of the term's PDFs. */

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function sql<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

test('admin sees the retention state per term and downloads the archive (Excel + ZIP of PDFs)', async ({ page }) => {
  await ensureActiveTerm();
  const [active] = await sql<{ id: string; term_no: number; academic_year: number }>(
    "SELECT id, term_no, academic_year FROM terms WHERE status = 'active'",
  );
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin');
  await page.getByRole('link', { name: 'ข้อมูลและความเป็นส่วนตัว' }).click();
  await expect(page.getByRole('heading', { name: 'ข้อมูลและความเป็นส่วนตัว' })).toBeVisible();
  const row = page.getByTestId(`retention-${active!.term_no}-${active!.academic_year}`);
  await expect(row).toContainText('ใช้งานอยู่');
  await expect(page.getByTestId('last-backup')).toContainText('สำรองข้อมูลล่าสุด');

  const zip = await page.request.get(`/api/v1/exports/terms/${active!.id}/pdfs`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toBe('application/zip');
  expect(zip.headers()['content-disposition']).toMatch(/attachment; filename="pdf-\d+-\d\.zip"/);
  const body = await zip.body();
  // a ZIP starts with a local header, or is only the end record when the term has no PDF yet
  expect([0x04034b50, 0x06054b50]).toContain(body.readUInt32LE(0));
  expect(body.readUInt32LE(body.length - 22)).toBe(0x06054b50);
  await expect(row.getByRole('link', { name: 'ผลคะแนน (Excel)' })).toHaveAttribute(
    'href',
    `/api/v1/exports/terms/${active!.id}`,
  );
});

test('the archive needs a staff login; a teacher is kept out of the privacy page', async ({ page, browser }) => {
  await ensureActiveTerm();
  const [active] = await sql<{ id: string }>("SELECT id FROM terms WHERE status = 'active'");
  const anon = await browser.newContext();
  await page.goto('/login');
  expect(
    (await anon.request.get(`${new URL(page.url()).origin}/api/v1/exports/terms/${active!.id}/pdfs`)).status(),
  ).toBe(401);
  await anon.close();
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await signIn(page, teacher, 'teacher-password');
  expect((await page.request.get(`/api/v1/exports/terms/${active!.id}/pdfs`)).status()).toBe(403);
  await page.goto('/admin/settings/privacy');
  await expect(page).not.toHaveURL(/\/admin\/settings\/privacy/);
});
