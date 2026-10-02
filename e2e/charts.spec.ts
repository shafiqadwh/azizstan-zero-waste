import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestUser, seedJourneyFixture } from './db';

/** T32: the public development chart (08-ux-ui §6.5) and the merged PDF of a round (FR-D5). */

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

/** An approved 4.5 on the fixture's class, written straight to the database (no PDF needed for the chart). */
async function approve(f: { roundId: string; componentId: string; classId: string; userId: string }) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO evaluations (id, round_id, component_id, target_type, target_class_id, owner_id, score, status,
         first_submitted_at, self_edit_until, last_edited_at, approved_by, approved_at, version)
       VALUES (gen_random_uuid(), $1, $2, 'class', $3, $4, 4.5, 'approved', now(), now(), now(), $4, now(), 1)`,
      [f.roundId, f.componentId, f.classId, f.userId],
    );
  } finally {
    await client.end();
  }
}

test('anyone opens a class chart; tap a round for its value; the table view has the same rows', async ({ page }) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);
  await approve(f);
  // a series nobody has viewed yet is computed now (the class list itself may be served from the 60 s cache,
  // so the test opens the chart by URL — the link from /classes is the same URL)
  await page.goto(`/charts?type=class&id=${f.classId}`);
  await expect(page.getByLabel(/เลือกห้องเรียนหรือ/)).toBeVisible();
  const series = page.getByTestId('series');
  await expect(series.getByRole('heading', { name: `${f.roomNumber} · ${f.className}` })).toBeVisible();
  await expect(page.getByTestId('series-chart')).toBeVisible();

  await page.getByRole('button', { name: /^รอบที่ 1:/ }).focus();
  await expect(page.getByRole('status')).toContainText('รอบที่ 1');

  await page.getByRole('button', { name: 'ตาราง' }).click();
  const table = page.getByTestId('series-table');
  await expect(table.getByRole('row', { name: /รอบที่ 1/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // the class's building has its own chart
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  const [{ area_id: areaId }] = (
    await client.query<{ area_id: string }>(
      'SELECT area_id FROM round_class_areas WHERE round_id = $1 AND class_id = $2',
      [f.roundId, f.classId],
    )
  ).rows as [{ area_id: string }];
  await client.end();
  await page.goto(`/charts?type=area&id=${areaId}`);
  await expect(series.getByRole('heading', { name: /อาคาร J/ })).toBeVisible();
  await expect(page.getByTestId('series-chart')).toBeVisible();
  // an unknown id says so instead of failing
  await page.goto('/charts?type=class&id=00000000-0000-7000-8000-000000000000');
  await expect(page.getByText('ไม่พบห้องเรียนหรือพื้นที่นี้ในภาคเรียนนี้')).toBeVisible();
});

test('staff download the merged PDF of a round; a teacher cannot', async ({ page, browser }) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  const res = await page.request.get(`/api/v1/exports/round/${f.roundId}/pdfs.pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');

  const ctx = await browser.newContext();
  const tPage = await ctx.newPage();
  await signIn(tPage, teacher, 'teacher-password');
  expect((await tPage.request.get(`/api/v1/exports/round/${f.roundId}/pdfs.pdf`)).status()).toBe(403);
  await ctx.close();
});
