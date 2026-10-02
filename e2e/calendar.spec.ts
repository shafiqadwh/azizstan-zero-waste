import { expect, test } from '@playwright/test';
import { ensureActiveTerm } from './db';

/**
 * T31: the public scoring calendar and its .ics download. Public pages are cached for up to a minute and other
 * specs add or remove rounds meanwhile, so these checks look at what is served (cards ↔ grid ↔ .ics agree);
 * exact dates are covered by src/lib/calendar/calendar.test.ts.
 */

test('anyone opens the calendar from home: each listed round has marked days; no horizontal scroll', async ({
  page,
}) => {
  await ensureActiveTerm();
  await page.goto('/');
  await page.getByRole('link', { name: 'ปฏิทินการประเมิน' }).click();
  await expect(page.getByRole('heading', { name: 'ปฏิทินการประเมิน' })).toBeVisible();
  const cards = page.getByTestId('calendar-rounds');
  if ((await cards.count()) === 0) {
    await expect(page.getByText('ยังไม่มีกำหนดการประเมินในภาคเรียนนี้')).toBeVisible();
  } else {
    const shown = (await cards.getByRole('heading').allTextContents()).map((t) => Number(t.replace(/\D/g, '')));
    expect(shown.length).toBeGreaterThan(0);
    for (const n of shown) expect(await page.locator(`[data-rounds~="${n}"]`).count()).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: 'เพิ่มลงปฏิทินในมือถือ (.ics)' })).toHaveAttribute(
      'href',
      '/calendar.ics',
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the .ics file is a valid calendar with at most one event per round', async ({ request }) => {
  await ensureActiveTerm();
  const res = await request.get('/calendar.ics');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
  const events = body.split('BEGIN:VEVENT').slice(1);
  const nos = events.map((e) => Number(/UID:round-(\d+)-/.exec(e)![1]));
  expect(new Set(nos).size).toBe(nos.length);
  for (const e of events) {
    const start = /DTSTART:(\d{8}T\d{6}Z)/.exec(e)![1]!;
    const end = /DTEND:(\d{8}T\d{6}Z)/.exec(e)![1]!;
    expect(start < end).toBe(true);
    expect(e).toContain('TRIGGER;RELATED=END:-PT24H');
  }
});
