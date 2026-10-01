import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createTestUser } from './db';

/** T25 `/admin/settings/students` (§6.15): runs, review list without names, mapping, skip rules, manual sync. */

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function sql(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

test('admin maps an unknown class from the review list; names never show; skip rules and manual sync', async ({
  page,
  browser,
}) => {
  const tag = randomBytes(3).toString('hex').toUpperCase();
  const code = `R${tag}`;
  const classString = `ชั้นแปลก ${tag}`;
  const name = `เด็กชายตรวจสอบ ${tag}`;
  await sql(
    `INSERT INTO students (id, student_code, full_name, status, review_reason, delete_after)
     VALUES (gen_random_uuid(), $1, $2, 'review', $3, current_date + 365)`,
    [code, name, `unknown_class:${classString}`],
  );
  await sql(
    `INSERT INTO sync_runs (id, source, started_at, finished_at, status, counts)
     VALUES (gen_random_uuid(), 'general', now(), now(), 'success', '{"rows": 1200, "added": 3, "skipped": 42}')`,
  );
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/settings/students');
  await expect(page.getByRole('heading', { name: 'นักเรียน', level: 1 })).toBeVisible();
  await expect(page.getByTestId('sync-runs')).toContainText('ข้าม 42 คน');
  const review = page.getByTestId('review-list');
  await expect(review).toContainText(code);
  await expect(review).toContainText(classString);
  await expect(page.locator('body')).not.toContainText(name);

  const map = page.getByRole('form', { name: `จับคู่ ${classString}` });
  await map.getByLabel('จับคู่กับห้อง').selectOption({ index: 1 });
  await map.getByRole('button', { name: 'บันทึก' }).click();
  await expect(map.getByRole('status')).toContainText('จับคู่แล้ว');
  expect(await sql('SELECT 1 FROM class_aliases WHERE alias = $1', [classString.toLowerCase()])).toHaveLength(1);

  const prefix = `ทดสอบข้าม${tag}`;
  await page.getByLabel('คำขึ้นต้นของชั้น').fill(prefix);
  await page.getByRole('button', { name: 'เพิ่ม' }).click();
  await expect(page.getByText(prefix)).toBeVisible();
  await page.getByRole('button', { name: `ลบ ${prefix}` }).click();
  await expect(page.getByText(prefix)).toHaveCount(0);

  await page.getByRole('button', { name: 'sync ตอนนี้' }).click();
  await expect(page.getByText('ส่งคำสั่งแล้ว')).toBeVisible();
  // the worker picks the request up from app_settings; the audit row proves this admin asked
  expect(
    await sql(
      `SELECT 1 FROM audit_logs a JOIN users u ON u.id = a.actor_id
        WHERE a.action = 'students.sync_request' AND u.username = $1`,
      [admin],
    ),
  ).toHaveLength(1);

  // executives read the page without any action
  const exec = await createTestUser({ role: 'executive', password: 'executive-password' });
  const ctx = await browser.newContext();
  const ep = await ctx.newPage();
  await signIn(ep, exec, 'executive-password');
  await ep.goto('/admin/settings/students');
  await expect(ep.getByText('โหมดดูอย่างเดียว')).toBeVisible();
  await expect(ep.getByRole('button', { name: 'sync ตอนนี้' })).toHaveCount(0);
  await expect(ep.getByRole('button', { name: 'เพิ่ม' })).toHaveCount(0);
  await ctx.close();
});
