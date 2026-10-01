import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { createTestUser, ensureActiveTerm } from './db';

/** T27: ปพ.5 API keys from the settings page, the API behind key + network checks, the term Excel export. */

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

test('admin creates a key; the ปพ.5 API answers on the school network only, with finalized rounds only', async ({
  page,
  playwright,
}) => {
  await ensureActiveTerm();
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password');
  await page.goto('/admin/settings/api');
  const name = `ปพ.5 ${Math.random().toString(36).slice(2, 7)}`;
  await page.getByLabel('ชื่อคีย์').fill(name);
  await page.getByRole('button', { name: 'สร้างคีย์ใหม่' }).click();
  const key = (await page.getByTestId('new-key').textContent())!.trim();
  expect(key).toMatch(/^zw_pp5_/);
  await expect(page.getByTestId('api-keys')).toContainText(name);

  const api = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  const auth = { Authorization: `Bearer ${key}` };
  expect((await api.get('/api/v1/pp5/terms')).status()).toBe(401);
  expect((await api.get('/api/v1/pp5/terms', { headers: { Authorization: 'Bearer nope' } })).status()).toBe(401);
  // a request that came through Cloudflare from the internet carries its public address
  expect(
    (await api.get('/api/v1/pp5/terms', { headers: { ...auth, 'CF-Connecting-IP': '203.0.113.7' } })).status(),
  ).toBe(403);

  const terms = await api.get('/api/v1/pp5/terms', { headers: auth });
  expect(terms.status()).toBe(200);
  const [active] = await sql<{ id: string }>("SELECT id FROM terms WHERE status = 'active'");
  // the ปพ.5 program gets CSV by default: UTF-8 with BOM, fixed header
  expect(terms.headers()['content-type']).toContain('text/csv');
  const termsCsv = await terms.text();
  expect(termsCsv.startsWith('\uFEFFterm_id,academic_year,term_no,final_max,rounds_finalized,rounds_total\r\n')).toBe(
    true,
  );
  expect(termsCsv).toContain(active!.id);
  const classesCsv = await api.get(`/api/v1/pp5/terms/${active!.id}/classes`, { headers: auth });
  expect(classesCsv.headers()['content-disposition']).toMatch(/attachment; filename="pp5-classes-\d+-\d\.csv"/);
  expect((await classesCsv.text()).split('\r\n')[0]).toBe(
    '\uFEFFacademic_year,term_no,term_complete,final_max,class_id,track,grade,class_name,display,source_class_key,round_no,class_score,area_score,round_total,term_score',
  );

  // the same data as JSON with ?format=json (05-api §3.3 shape)
  const classes = await api.get(`/api/v1/pp5/terms/${active!.id}/classes?format=json`, { headers: auth });
  expect(classes.status()).toBe(200);
  const body = await classes.json();
  expect(Object.keys(body).sort()).toEqual(
    [
      'academicYear',
      'classes',
      'finalMax',
      'generatedAt',
      'roundsFinalized',
      'roundsTotal',
      'termComplete',
      'termNo',
    ].sort(),
  );
  const finalized = await sql<{ round_no: number }>(
    "SELECT round_no FROM rounds WHERE term_id = $1 AND status = 'finalized' ORDER BY round_no",
    [active!.id],
  );
  expect(body.roundsFinalized).toEqual(finalized.map((r) => r.round_no));
  for (const c of body.classes as { rounds: { roundNo: number }[]; sourceClassKey: string }[]) {
    expect(c.rounds.every((r) => body.roundsFinalized.includes(r.roundNo))).toBe(true);
    expect(typeof c.sourceClassKey).toBe('string');
  }
  expect(body.generatedAt).toMatch(/\+07:00$/);

  const xlsx = await page.request.get(`/api/v1/exports/terms/${active!.id}`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  expect((await api.get(`/api/v1/exports/terms/${active!.id}`)).status()).toBe(401); // the export needs a staff login

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: `ยกเลิกคีย์ ${name}` }).click();
  await expect(page.getByTestId(`api-key-${name}`)).toContainText('ยกเลิกแล้ว');
  expect((await api.get('/api/v1/pp5/terms', { headers: auth })).status()).toBe(401);
  await api.dispose();
});
