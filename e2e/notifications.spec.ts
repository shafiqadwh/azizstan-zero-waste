import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestUser } from './db';

/** T26: inbox + bell, push subscription API, PWA manifest/service worker, iOS install guide. */

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

test('the bell counts unread notifications; opening one marks it read and follows its link', async ({ page }) => {
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await sql(
    `INSERT INTO notifications (id, user_id, type, title, body, link, created_at)
     SELECT gen_random_uuid(), id, 'request_created', 'มีคำขออนุมัติใหม่', 'แก้คะแนน · 121 · ม.1 Amanah', '/admin/approvals?tab=requests', now()
       FROM users WHERE username = $1`,
    [admin],
  );
  await signIn(page, admin, 'admin-password');
  await expect(page.getByTestId('unread-badge')).toHaveText('1');
  await page.getByRole('link', { name: 'การแจ้งเตือน ยังไม่อ่าน 1 รายการ' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  const inbox = page.getByTestId('inbox');
  await expect(inbox).toContainText('มีคำขออนุมัติใหม่');
  await inbox.getByRole('button', { name: /มีคำขออนุมัติใหม่/ }).click();
  await expect(page).toHaveURL(/\/admin\/approvals\?tab=requests/);
  await expect(page.getByTestId('unread-badge')).toHaveCount(0);
});

test('push subscription API: https only, stored for the user, removable', async ({ page }) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await signIn(page, teacher, 'teacher-password');
  const endpoint = `https://push.example.test/${teacher}`;
  const headers = { Origin: new URL(page.url()).origin };
  const keys = { p256dh: 'BPcMbnWQL5GOYX-fake-p256dh-key', auth: 'fake-auth-secret' };
  expect(
    (
      await page.request.post('/api/v1/push/subscription', { headers, data: { endpoint: 'http://x.test/1', keys } })
    ).status(),
  ).toBe(422);
  expect(
    (
      await page.request.post('/api/v1/push/subscription', {
        headers: { Origin: 'https://evil.example' },
        data: { endpoint, keys },
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.post('/api/v1/push/subscription', { headers, data: { endpoint, keys } })).status()).toBe(
    201,
  );
  expect(await sql('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint])).toHaveLength(1);
  expect((await page.request.delete('/api/v1/push/subscription', { headers, data: { endpoint } })).status()).toBe(200);
  expect(await sql('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint])).toHaveLength(0);
  const anon = await page.context().browser()!.newContext();
  expect(
    (
      await anon.request.post(`${new URL(page.url()).origin}/api/v1/push/subscription`, { data: { endpoint, keys } })
    ).status(),
  ).toBe(401);
  await anon.close();
});

test('the app is installable: manifest, icons and the push service worker are served', async ({ page }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'AZIZSTAN ZERO WASTE', display: 'standalone', lang: 'th' });
  for (const icon of manifest.icons as { src: string }[]) expect((await page.request.get(icon.src)).status()).toBe(200);
  const sw = await page.request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain("addEventListener('push'");
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
});

test('iOS Safari shows the add-to-home-screen guide; "ไว้ทีหลัง" hides it on this device', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  await signIn(page, teacher, 'teacher-password');
  await page.goto('/inbox');
  const sheet = page.getByTestId('install-prompt');
  await expect(sheet).toContainText('ติดตั้งแอปเพื่อรับการแจ้งเตือน');
  await expect(sheet).toContainText('แตะปุ่มแชร์');
  await expect(sheet).toContainText('เพิ่มไปยังหน้าจอโฮม');
  await expect(sheet).toContainText('เปิดจากไอคอนบนหน้าจอโฮม');
  await sheet.getByRole('button', { name: 'ไว้ทีหลัง' }).click();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'การแจ้งเตือน' })).toBeVisible();
  await expect(page.getByTestId('install-prompt')).toHaveCount(0);
  await ctx.close();
});
