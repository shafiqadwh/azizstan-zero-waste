import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { createTestUser, seedUploadFixture } from './db';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

test('committee uploads a GPS-tagged photo; the stored WebP has no EXIF; thumbnails and permissions', async ({
  page,
  browser,
}) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const { classId } = await seedUploadFixture(teacher);
  await signIn(page, teacher, 'teacher-password');

  const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#6a8' } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '6/1 52/1 0/1' } })
    .toBuffer();
  const res = await page.request.post('/api/v1/uploads', {
    multipart: {
      file: { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: photo },
      kind: 'site',
      targetRef: `class:${classId}`,
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { evidenceId: string; url: string; capturedAt: string };
  expect(body.url).toBe(`/api/v1/files/${body.evidenceId}`);

  const full = await page.request.get(body.url);
  expect(full.headers()['content-type']).toBe('image/webp');
  const meta = await sharp(await full.body()).metadata();
  expect(meta).toMatchObject({ format: 'webp', width: 1600, height: 1067 });
  expect(meta.exif).toBeUndefined();
  const thumb = await page.request.get(`${body.url}?w=320`);
  expect((await sharp(await thumb.body()).metadata()).width).toBe(320);

  // wrong target → 403 with the Thai message; non-image → 422
  const denied = await page.request.post('/api/v1/uploads', {
    multipart: {
      file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: photo },
      kind: 'site',
      targetRef: 'class:00000000-0000-7000-8000-000000000000',
    },
  });
  expect(denied.status()).toBe(403);
  expect(await denied.json()).toMatchObject({ error: { code: 'FORBIDDEN', message: 'คุณไม่มีสิทธิ์ทำรายการนี้' } });
  const notImage = await page.request.post('/api/v1/uploads', {
    multipart: {
      file: { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      kind: 'site',
      targetRef: `class:${classId}`,
    },
  });
  expect(notImage.status()).toBe(422);

  // another teacher cannot read it; anonymous gets 401
  const other = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const ctx = await browser.newContext();
  const otherPage = await ctx.newPage();
  await signIn(otherPage, other, 'teacher-password');
  expect((await otherPage.request.get(body.url)).status()).toBe(403);
  await ctx.close();
  const anon = await browser.newContext();
  expect((await anon.request.get(new URL(body.url, page.url()).toString())).status()).toBe(401);
  await anon.close();
});
