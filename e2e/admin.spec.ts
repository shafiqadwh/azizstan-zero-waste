import { expect, test, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { createDb } from '../db/client';
import type { PdfRenderer } from '../src/server/pdf/renderer';
import { renderEvaluationPdf } from '../src/server/services/pdf.service';
import { createTestUser, seedJourneyFixture, seedOldEvaluation } from './db';

/** 13-testing §4 journeys 2 and 5 (desktop). */
test.beforeEach(({}, info) => {
  test.skip(info.project.name.includes('mobile'), 'desktop journeys');
});

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

async function staffPage(browser: Browser, role: 'admin' | 'executive') {
  const username = await createTestUser({ role, password: `${role}-password` });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, username, `${role}-password`);
  return { page, close: () => ctx.close() };
}

/** A submitted evaluation (4.5) on a fresh class, owned by a fresh committee teacher. */
async function waitingEvaluation() {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);
  return { ...f, evaluationId: await seedOldEvaluation(f) };
}

async function evaluationStatus(id: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    return (await client.query<{ status: string }>('SELECT status FROM evaluations WHERE id = $1', [id])).rows[0]!
      .status;
  } finally {
    await client.end();
  }
}

test('journey 2: admin approves from the approvals page (keyboard A); the PDF link appears once rendered', async ({
  page,
  browser,
}) => {
  const f = await waitingEvaluation();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await expect(page.getByRole('heading', { name: 'ภาพรวม' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'ตัวชี้วัด' })).toContainText('รออนุมัติ');

  await page.goto('/admin/approvals');
  await expect(page.getByRole('tab', { name: /ผลประเมิน/ })).toHaveAttribute('aria-selected', 'true');
  const card = page.getByTestId(`result-${f.className}`);
  await expect(card).toContainText(`${f.roomNumber} · ${f.className}`);
  await expect(card.getByTestId('result-score')).toContainText('4.5');
  await expect(card.getByRole('img')).toHaveCount(4);
  await expect(card.getByRole('img').last()).toHaveAttribute('alt', 'ใบลงชื่อนักเรียน'); // signature last
  await card.getByText('คะแนนห้องเรียน').click(); // focus the card, then approve with the keyboard
  await expect(card).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('a');
  await expect(page.getByRole('main').getByRole('status')).toContainText(
    `อนุมัติ ${f.roomNumber} · ${f.className} แล้ว`,
  );
  await expect(card).toHaveCount(0); // decided cards leave the waiting list
  expect(await evaluationStatus(f.evaluationId)).toBe('approved');

  await page.goto(`/evaluate/${f.evaluationId}`);
  await expect(page.getByText('กำลังสร้าง PDF…')).toBeVisible();
  // what the worker does for the queued row, printed with this test's Chromium
  const renderer: PdfRenderer = {
    async render(html) {
      const p = await browser.newPage();
      try {
        await p.setContent(html, { waitUntil: 'load' });
        return await p.pdf({ printBackground: true, preferCSSPageSize: true });
      } finally {
        await p.close();
      }
    },
    async close() {},
  };
  const { db, close } = createDb(process.env.DATABASE_URL!);
  try {
    expect(await renderEvaluationPdf(db, f.evaluationId, new Date(), renderer)).toMatchObject({ version: 1 });
  } finally {
    await close();
  }
  await page.reload();
  const link = page.getByRole('link', { name: 'ดู PDF' });
  await expect(link).toBeVisible();
  const pdf = await page.request.get((await link.getAttribute('href'))!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('returning a result asks for a reason and sends it back to the owner', async ({ page }) => {
  const f = await waitingEvaluation();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/approvals?tab=results');
  const card = page.getByTestId(`result-${f.className}`);
  await card.getByRole('button', { name: 'ส่งกลับ' }).click();
  const sheet = card.getByRole('form', { name: 'ส่งกลับให้แก้' });
  await sheet.getByRole('button', { name: 'ส่งกลับ' }).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await sheet.getByLabel('เหตุผลที่ส่งกลับ').fill('รูปไม่ชัด ถ่ายใหม่');
  await sheet.getByRole('button', { name: 'ส่งกลับ' }).click();
  await expect(card).toHaveCount(0);
  expect(await evaluationStatus(f.evaluationId)).toBe('returned');
});

test('journey 5: executive sees every page read-only; a replayed server action is refused', async ({
  page,
  browser,
}) => {
  const first = await waitingEvaluation();
  const second = await waitingEvaluation();

  // capture the real "approve" server action call made by an admin on the first evaluation
  const admin = await staffPage(browser, 'admin');
  await admin.page.goto('/admin/approvals');
  const adminCard = admin.page.getByTestId(`result-${first.className}`);
  const [call] = await Promise.all([
    admin.page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action']),
    adminCard.getByRole('button', { name: 'อนุมัติและออก PDF' }).click(),
  ]);
  await expect(adminCard).toHaveCount(0);
  await admin.close();

  const executive = await createTestUser({ role: 'executive', password: 'executive-password' });
  await signIn(page, executive, 'executive-password');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'ภาพรวม' })).toBeVisible();
  await expect(page.getByText('โหมดดูอย่างเดียว')).toBeVisible();
  await expect(page.getByRole('button', { name: 'แจ้งเตือนกรรมการที่ค้าง' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ปิดรอบ' })).toHaveCount(0);

  await page.goto('/admin/approvals');
  await expect(page.getByText('โหมดดูอย่างเดียว')).toBeVisible();
  await expect(page.getByTestId(`result-${second.className}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'อนุมัติและออก PDF' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ส่งกลับ' })).toHaveCount(0);
  await page.keyboard.press('a'); // shortcuts do nothing without the right
  await page.goto('/admin/approvals?tab=requests');
  await expect(page.getByRole('button', { name: 'อนุมัติการแก้ไข' })).toHaveCount(0);

  for (const [path, heading] of [
    ['/admin/settings/term', 'ภาคเรียน'],
    ['/admin/settings/committee', 'คณะกรรมการ'],
    ['/admin/settings/classes', 'ห้องเรียน'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page.getByText('โหมดดูอย่างเดียว').first()).toBeVisible();
  }

  // direct call: the admin's request replayed with the executive's session, aimed at the second evaluation
  const headers = call.headers();
  const res = await page.request.post(call.url(), {
    headers: {
      'next-action': headers['next-action']!,
      'content-type': headers['content-type'] ?? 'text/plain;charset=UTF-8',
      accept: 'text/x-component',
      origin: new URL(call.url()).origin,
    },
    data: call.postData()!.replace(first.evaluationId, second.evaluationId),
  });
  expect(await res.text()).toContain('FORBIDDEN');
  expect(await evaluationStatus(second.evaluationId)).toBe('submitted');
  expect(await evaluationStatus(first.evaluationId)).toBe('approved');
});
