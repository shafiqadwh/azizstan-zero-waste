import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestUser, seedJourneyFixture, seedOldEvaluation } from './db';

/** 13-testing §4 journey 6 and T24: public pages, no person on them, approved scores reach the rankings. */

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

/** Fake students in the fixture's class: their names must never show on a public page. */
async function seedStudents(classId: string, tag: string) {
  const names = [`เด็กชายสมมติ ${tag}`, `เด็กหญิงทดลอง ${tag}`];
  for (const [i, name] of names.entries()) {
    await sql(
      `INSERT INTO students (id, student_code, full_name, home_class_id, delete_after)
       VALUES (gen_random_uuid(), $1, $2, $3, current_date + 365)`,
      [`E2E${tag}${i}`, name, classId],
    );
  }
  return names;
}

test('journey 6: home → rankings → toggle building → class picker; no student or evaluator name anywhere', async ({
  page,
  browser,
}) => {
  const teacher = await createTestUser({ role: 'teacher', password: 'teacher-password' });
  const f = await seedJourneyFixture(teacher);
  await seedOldEvaluation(f);
  const names = await seedStudents(f.classId, f.roomNumber);

  // an admin approves it — the public pages refresh through the cache tag (journey 2, public half)
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  const ctx = await browser.newContext();
  const adminPage = await ctx.newPage();
  await signIn(adminPage, admin, 'admin-password');
  await adminPage.goto('/admin/approvals');
  await adminPage.getByTestId(`result-${f.className}`).getByRole('button', { name: 'อนุมัติและออก PDF' }).click();
  await expect(adminPage.getByTestId(`result-${f.className}`)).toHaveCount(0);
  await ctx.close();

  await page.goto('/');
  await expect(page.getByRole('region', { name: 'สถานะรอบ' })).toBeVisible();
  await page.getByTestId('tile-rankings').click();
  await expect(page).toHaveURL(/\/rankings$/);
  await expect(page.getByRole('heading', { name: 'จัดอันดับ' })).toBeVisible();
  await page.getByRole('link', { name: 'รอบที่ 1' }).click();
  await expect(page).toHaveURL(/round=1/);
  const group = page.getByTestId('rank-ม.J');
  await expect(group).toContainText(`${f.roomNumber} · ${f.className}`);
  await page.getByRole('navigation', { name: 'ประเภท' }).getByRole('link', { name: 'อาคาร' }).click();
  await expect(page).toHaveURL(/view=areas/);
  await expect(page.getByTestId('rank-areas')).toContainText(`อาคาร J`);

  await page.goto('/classes');
  await page.getByLabel('ชั้น').selectOption('ม.J');
  await page.getByLabel('ห้อง').selectOption({ label: `${f.roomNumber} · ${f.className}` });
  await expect(page).toHaveURL(new RegExp(`class=${f.classId}`));
  const card = page.getByTestId('class-scores');
  await expect(card).toContainText(`${f.roomNumber} · ${f.className}`);
  await expect(card).toContainText('รอบที่ 1');
  await expect(card.getByRole('cell', { name: '4.5' }).first()).toBeVisible(); // the room score

  for (const path of [
    '/',
    '/rankings',
    '/rankings?round=1',
    '/rankings?view=areas',
    `/classes?class=${f.classId}`,
    '/areas',
    '/orders',
    '/guide',
  ]) {
    await page.goto(path);
    const text = await page.locator('body').innerText();
    for (const name of [...names, 'ผู้ทดสอบ teacher', 'ผู้ทดสอบ admin'])
      expect(text, `${path}: ${name}`).not.toContain(name);
    expect(await page.locator('img[src*="/api/v1/files/"]').count(), path).toBe(0);
  }
});

test('admin publishes an order and a guide page; both appear publicly', async ({ page, browser }) => {
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/settings/content');
  const tag = Math.random().toString(36).slice(2, 8);
  await page.getByLabel('ชื่อเอกสาร').fill(`คำสั่งทดสอบ ${tag}`);
  await page.getByLabel('ไฟล์ PDF').setInputFiles({
    name: 'order.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% test order\n'),
  });
  await page.getByRole('button', { name: 'อัปโหลด' }).click();
  await expect(page.getByRole('status')).toHaveText('อัปโหลดแล้ว');

  await page.getByRole('link', { name: '+ เพิ่มหน้าคู่มือ' }).click();
  const editor = page.getByRole('form', { name: 'แก้ไขหน้าคู่มือ' });
  await editor.getByLabel('ชื่อหน้า').fill(`ดูอันดับ ${tag}`);
  await editor.getByLabel(/ชื่อในลิงก์/).fill(`ranking-${tag}`);
  await editor
    .getByLabel(/เนื้อหา/)
    .fill('## ขั้นตอน\n\n- เปิด **จัดอันดับ**\n- เลือก [รอบ](/rankings)\n\n<script>alert(1)</script>');
  await editor.getByRole('button', { name: 'บันทึก' }).click();
  await expect(editor.getByRole('status')).toContainText('บันทึกแล้ว');

  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto('/orders');
  const link = pub.getByRole('link', { name: `คำสั่งทดสอบ ${tag}` });
  await expect(link).toBeVisible();
  const file = await pub.request.get((await link.getAttribute('href'))!);
  expect(file.headers()['content-type']).toContain('application/pdf');
  await pub.goto('/guide');
  await pub.getByRole('link', { name: `ดูอันดับ ${tag}` }).click();
  await expect(pub.getByRole('heading', { name: 'ขั้นตอน' })).toBeVisible();
  await expect(pub.locator('article strong')).toHaveText('จัดอันดับ');
  await expect(pub.locator('article a')).toHaveAttribute('href', '/rankings');
  await expect(pub.locator('article')).toContainText('<script>alert(1)</script>'); // shown as text, never run
  await expect(pub.locator('article script')).toHaveCount(0);
  await anon.close();
});

test('LCP budget: the home page paints its largest content within 2 s on a throttled mid-range phone', async ({
  page,
  browserName,
}, info) => {
  test.skip(!info.project.name.includes('mobile') || browserName !== 'chromium', 'measured once, mobile Chromium');
  await page.goto('/'); // warm the dev server and the public cache
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // "fast 4G" (Lighthouse mobile preset ≈ 150 ms RTT, 1.6 Mbps down) and a 4× slower CPU
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('/', { waitUntil: 'load' });
  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(entries[entries.length - 1]!.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
  );
  console.log(`home LCP (throttled): ${Math.round(lcp)} ms`);
  expect(lcp).toBeLessThan(2000);
});
