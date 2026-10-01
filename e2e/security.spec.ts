import { expect, test, type Page } from '@playwright/test';
import { createTestUser, ensureActiveTerm } from './db';

/** T29: security headers and the nonce CSP (12-security §2 item 1) — pages still hydrate with no violations. */

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้').fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
}

function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(msg.text())) violations.push(msg.text());
  });
  return violations;
}

test('pages send the security headers and a per-request nonce CSP', async ({ page }) => {
  const first = await page.goto('/');
  const h = first!.headers();
  expect(h['strict-transport-security']).toContain('max-age=31536000');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('same-origin');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-powered-by']).toBeUndefined();
  const csp = h['content-security-policy']!;
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  const second = (await page.goto('/'))!.headers()['content-security-policy'];
  expect(second).not.toBe(csp); // a fresh nonce per request
  // API responses get the static headers too
  const api = await page.request.get('/api/v1/health');
  expect(api.headers()['x-content-type-options']).toBe('nosniff');
});

test('public and signed-in pages hydrate under the CSP without violations', async ({ page }) => {
  await ensureActiveTerm();
  const violations = watchCsp(page);
  for (const path of ['/', '/rankings', '/classes', '/guide']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
  }
  const admin = await createTestUser({ role: 'admin', password: 'admin-password' });
  await signIn(page, admin, 'admin-password'); // the login form is a client component: it needs its scripts
  for (const path of ['/admin', '/monitor', '/admin/settings/privacy', '/inbox']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
  }
  // client-side navigation works (Next's runtime loaded under 'strict-dynamic')
  await page.goto('/admin');
  await page.getByRole('link', { name: 'ข้อมูลและความเป็นส่วนตัว' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/privacy$/);
  expect(violations).toEqual([]);
});
