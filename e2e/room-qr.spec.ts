import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import QRCode from 'qrcode';
import { createTestUser, seedJourneyFixture } from './db';

/** T34: printable QR sheet of the rooms (08-ux-ui §6.21 "พิมพ์ QR ทุกห้อง"); admins only. */

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('admin prints the QR of one room: the card carries the door URL of that room', async ({ page, browser }) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  const [room] = (
    await client.query<{ id: string; qr_token: string }>(
      'SELECT id, qr_token FROM physical_rooms WHERE room_number = $1',
      [f.roomNumber],
    )
  ).rows;
  await client.end();

  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/settings/classes');
  await expect(page.getByRole('link', { name: 'พิมพ์ QR ทุกห้อง' })).toHaveAttribute('href', '/api/v1/pdf/room-qr');
  await expect(page.getByRole('link', { name: `พิมพ์ QR ห้อง ${f.roomNumber}` })).toHaveAttribute(
    'href',
    `/api/v1/pdf/room-qr?roomId=${room!.id}`,
  );

  const html = await (await page.request.get(`/api/v1/pdf/room-qr?roomId=${room!.id}&format=html`)).text();
  expect(html).toContain(`<div class="no">${f.roomNumber}</div>`);
  expect(html).toContain(f.className);
  // the QR encodes <origin>/r/<qr_token> (no APP_URL in the test server)
  const expected = await QRCode.toString(`${new URL(page.url()).origin}/r/${room!.qr_token}`, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  expect(html).toContain(expected);

  const pdf = await page.request.get(`/api/v1/pdf/room-qr?roomId=${room!.id}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1);

  // the whole school prints too
  expect((await page.request.get('/api/v1/pdf/room-qr?format=html')).status()).toBe(200);

  const ctx = await browser.newContext();
  const tPage = await ctx.newPage();
  await signIn(tPage, teacher, 'teacher-password');
  expect((await tPage.request.get(`/api/v1/pdf/room-qr?roomId=${room!.id}`)).status()).toBe(403);
  await ctx.close();
});
