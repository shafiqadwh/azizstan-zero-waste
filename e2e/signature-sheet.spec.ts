import { expect, test, type Page } from '@playwright/test';
import { createTestUser, seedJourneyFixture } from './db';

/** T30: the printable signature sheet (09-pdf §3) from the evaluation form; committee on the class or staff only. */

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('committee prints a blank sheet for the room from the form: one A4 page PDF, 40 numbered lines', async ({
  page,
  browser,
}) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const { roomNumber, className, roundId, classId } = await seedJourneyFixture(teacher);
  await signIn(page, teacher, 'teacher-password');
  await page.goto('/tasks');
  await page.getByPlaceholder('เลขห้อง เช่น 121').fill(roomNumber);
  await page.getByTestId(`task-${roomNumber}`).click();
  const link = page.getByRole('link', { name: 'พิมพ์ใบลงชื่อ (PDF)' });
  await expect(link).toHaveAttribute('href', `/api/v1/pdf/signature-sheet?classId=${classId}&roundId=${roundId}`);

  const pdf = await page.request.get((await link.getAttribute('href'))!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1); // always one page

  const html = await (await page.request.get(`${(await link.getAttribute('href'))!}&format=html`)).text();
  expect(html).toContain(`${roomNumber} · ${className}`);
  expect(html).toContain('โปรดถ่ายรูปแผ่นนี้แนบในระบบ');
  expect(html.match(/<td class="no">\d+<\/td>/g)).toHaveLength(40);

  // another teacher without a duty on this class gets 403; anonymous 401
  const other = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const ctx = await browser.newContext();
  const otherPage = await ctx.newPage();
  await signIn(otherPage, other, 'teacher-password');
  expect(
    (await otherPage.request.get(`/api/v1/pdf/signature-sheet?classId=${classId}&roundId=${roundId}`)).status(),
  ).toBe(403);
  await ctx.close();
  const anon = await browser.newContext();
  expect(
    (
      await anon.request.get(
        `${new URL(page.url()).origin}/api/v1/pdf/signature-sheet?classId=${classId}&roundId=${roundId}`,
      )
    ).status(),
  ).toBe(401);
  await anon.close();
});

test('an admin prints the sheet too; an unknown class in the round is 404', async ({ page }) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const { roundId, classId } = await seedJourneyFixture(teacher);
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  const ok = await page.request.get(`/api/v1/pdf/signature-sheet?classId=${classId}&roundId=${roundId}&format=html`);
  expect(ok.status()).toBe(200);
  const missing = await page.request.get(
    `/api/v1/pdf/signature-sheet?classId=00000000-0000-7000-8000-000000000000&roundId=${roundId}`,
  );
  expect(missing.status()).toBe(404);
});
