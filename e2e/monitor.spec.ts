import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestUser, seedJourneyFixture, seedOldEvaluation } from './db';

/** T23b: monitor board scope, filters in the URL, popover, activity feed, PDF retry, requests log, my requests. */

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

async function committee() {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  return { teacher, ...(await seedJourneyFixture(teacher)) };
}

test('a teacher-committee sees only assigned targets; the API refuses another target with 403', async ({ page }) => {
  const mine = await committee();
  const other = await committee();
  await signIn(page, mine.teacher, 'teacher-password');
  await page.goto('/monitor');
  await expect(page.getByRole('heading', { name: 'ติดตามสถานะ' })).toBeVisible();
  await expect(page.getByTestId('row-count')).toHaveText('1 รายการ');
  await expect(page.getByTestId(`tile-${mine.className}`)).toBeVisible();
  await expect(page.getByTestId(`tile-${other.className}`)).toHaveCount(0);
  await expect(page.getByLabel('เฉพาะที่ฉันรับผิดชอบ')).toHaveCount(0);

  const own = await page.request.get(`/api/v1/monitor/targets/class/${mine.classId}?round=${mine.roundId}`);
  expect(own.status()).toBe(200);
  const denied = await page.request.get(`/api/v1/monitor/targets/class/${other.classId}?round=${other.roundId}`);
  expect(denied.status()).toBe(403);
  const board = await (await page.request.get(`/api/v1/monitor/board?round=${mine.roundId}`)).json();
  expect(board.rows.map((r: { target: { id: string } }) => r.target.id)).toEqual([mine.classId]);
});

test('admin: filters live in the URL, counters filter, map and table show the same rows, popover lists who is responsible', async ({
  page,
}) => {
  const f = await committee();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/monitor');
  await page.getByLabel('ค้นหาห้อง').fill(f.roomNumber);
  await page.getByRole('button', { name: 'ใช้ตัวกรอง' }).click();
  await expect(page).toHaveURL(new RegExp(`q=${f.roomNumber}`));
  await expect(page.getByTestId('row-count')).toHaveText('1 รายการ');
  await expect(page.getByRole('link', { name: 'ล้างตัวกรอง' })).toBeVisible();
  const tile = page.getByTestId(`tile-${f.className}`);
  await expect(tile).toHaveAttribute('data-status', 'not_evaluated');

  // the counter "ยังไม่ประเมิน" shows exactly its number of rows
  const counter = page.getByTestId('counter-not_evaluated');
  await expect(counter).toContainText('1');
  await counter.click();
  await expect(page).toHaveURL(/status=not_evaluated/);
  await expect(page.getByTestId('row-count')).toHaveText('1 รายการ');
  await page.getByTestId('counter-approved').click();
  await expect(page.getByTestId('row-count')).toHaveText('0 รายการ');
  await page.getByTestId('counter-approved').click(); // toggles off
  await expect(page).not.toHaveURL(/status=/);
  await expect(page.getByTestId('row-count')).toHaveText('1 รายการ');

  await page.getByRole('link', { name: 'ตาราง' }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(page).toHaveURL(new RegExp(`q=${f.roomNumber}`)); // filters survive the view switch
  await expect(page.getByTestId('board-table')).toBeVisible();
  await expect(page.getByTestId('row-count')).toHaveText('1 รายการ');
  await expect(page.getByTestId(`row-${f.className}`)).toContainText('ผู้ทดสอบ teacher');

  await page.getByRole('button', { name: `${f.roomNumber} · ${f.className}` }).click();
  const dialog = page.getByRole('dialog', { name: `ผู้รับผิดชอบ ${f.roomNumber} · ${f.className}` });
  await expect(dialog).toContainText('กรรมการผู้รับผิดชอบ');
  await expect(dialog).toContainText('ผู้ทดสอบ teacher');
  await expect(dialog).toContainText('ยังไม่มีผู้ประเมิน');

  const xlsx = await page.request.get(`/api/v1/monitor/export.xlsx?round=${f.roundId}&q=${f.roomNumber}`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
});

test('an approval shows in the activity feed; a forced PDF failure shows in "PDF ล้มเหลว" and recovers with สร้างใหม่', async ({
  page,
  browser,
}) => {
  const f = await committee();
  const evaluationId = await seedOldEvaluation(f);
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/approvals');
  await page.getByTestId(`result-${f.className}`).getByRole('button', { name: 'อนุมัติและออก PDF' }).click();
  await expect(page.getByTestId(`result-${f.className}`)).toHaveCount(0);

  await page.goto(`/monitor?q=${f.roomNumber}`);
  await expect(page.getByTestId('activity')).toContainText(`อนุมัติผลประเมิน ${f.roomNumber} · ${f.className}`);
  await expect(page.getByTestId(`tile-${f.className}`)).toHaveAttribute('data-status', 'approved');

  await sql("UPDATE evaluations SET pdf_status = 'failed', pdf_error = 'chromium crashed' WHERE id = $1", [
    evaluationId,
  ]);
  await page.goto(`/monitor?q=${f.roomNumber}&status=pdf_failed&view=table`);
  await expect(page.getByTestId('counter-pdf_failed')).toContainText('1');
  const row = page.getByTestId(`row-${f.className}`);
  await expect(row).toContainText('chromium crashed');

  // executives see the failure but no action
  const exec = await createTestUser({ role: 'executive', password: 'executive-password' });
  const ctx = await browser.newContext();
  const execPage = await ctx.newPage();
  await signIn(execPage, exec, 'executive-password');
  await execPage.goto(`/monitor?q=${f.roomNumber}&status=pdf_failed&view=table`);
  await expect(execPage.getByTestId(`row-${f.className}`)).toContainText('ล้มเหลว');
  await expect(execPage.getByRole('button', { name: 'สร้างใหม่' })).toHaveCount(0);
  await ctx.close();

  await row.getByRole('button', { name: 'สร้างใหม่' }).click();
  await expect(page.getByTestId('row-count')).toHaveText('0 รายการ');
  expect(
    (await sql<{ pdf_status: string }>('SELECT pdf_status FROM evaluations WHERE id = $1', [evaluationId]))[0],
  ).toEqual({ pdf_status: 'queued' });
});

test('"คำขอของฉัน" shows the status and the late-entry countdown; the requests log lists it', async ({
  page,
  browser,
}) => {
  const f = await committee();
  await sql(
    `INSERT INTO requests (id, type, status, requester_id, round_id, component_id, target_type, target_class_id,
       reason, payload, decided_at, grant_until)
     VALUES (gen_random_uuid(), 'late_entry', 'approved', $1, $2, $3, 'class', $4, 'ป่วยในวันที่ประเมิน', '{"hours":24}',
       now(), now() + interval '17 hours 30 minutes')`,
    [f.userId, f.roundId, f.componentId, f.classId],
  );
  await signIn(page, f.teacher, 'teacher-password');
  await page.goto('/tasks');
  await page.getByRole('link', { name: /คำขอของฉัน/ }).click();
  await expect(page).toHaveURL(/view=requests/);
  const card = page.getByTestId(`my-request-${f.className}`);
  await expect(card).toContainText('ขอใส่คะแนนหลังกำหนด');
  await expect(card).toContainText('อนุมัติแล้ว');
  await expect(card).toContainText('ใส่คะแนนได้อีก 18 ชม.');
  await expect(card.getByRole('link', { name: 'ไปใส่คะแนน' })).toHaveAttribute(
    'href',
    `/evaluate/new?round=${f.roundId}&component=${f.componentId}&target=class:${f.classId}`,
  );

  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  const ctx = await browser.newContext();
  const adminPage = await ctx.newPage();
  await signIn(adminPage, admin, 'admin-password');
  await adminPage.goto('/admin/requests?status=approved&type=late_entry');
  await expect(adminPage.getByTestId(`log-${f.className}`)).toContainText('ป่วยในวันที่ประเมิน');
  await expect(adminPage.getByTestId(`log-${f.className}`)).toContainText('อนุมัติแล้ว');
  await ctx.close();
});
