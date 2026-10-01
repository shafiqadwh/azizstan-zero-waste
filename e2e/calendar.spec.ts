import { expect, test } from '@playwright/test';
import pg from 'pg';
import { ensureActiveTerm } from './db';

/** T31: the public scoring calendar generated from the active term's rounds, and its .ics download. */

async function activeRounds() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL! });
  await client.connect();
  try {
    return (
      await client.query<{ round_no: number }>(
        "SELECT r.round_no FROM rounds r JOIN terms t ON t.id = r.term_id WHERE t.status = 'active' ORDER BY r.round_no",
      )
    ).rows;
  } finally {
    await client.end();
  }
}

test('anyone opens the calendar from home: every round listed, its days marked, no horizontal scroll', async ({
  page,
}) => {
  await ensureActiveTerm();
  await page.goto('/');
  await page.getByRole('link', { name: 'ปฏิทินการประเมิน' }).click();
  await expect(page.getByRole('heading', { name: 'ปฏิทินการประเมิน' })).toBeVisible();
  const rounds = await activeRounds();
  if (rounds.length === 0) {
    await expect(page.getByText('ยังไม่มีกำหนดการประเมินในภาคเรียนนี้')).toBeVisible();
    return;
  }
  const list = page.getByTestId('calendar-rounds');
  for (const r of rounds) await expect(list.getByRole('heading', { name: `รอบที่ ${r.round_no}` })).toBeVisible();
  // at least one marked day per round in the month grids
  for (const r of rounds)
    expect(
      await page.locator(`[data-rounds~="${r.round_no}"], [data-rounds*=",${r.round_no}"]`).count(),
    ).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the .ics file lists one event per round', async ({ request }) => {
  await ensureActiveTerm();
  const res = await request.get('/calendar.ics');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  // other specs change rounds while the public cache lives: check the file is consistent in itself
  const events = body.split('BEGIN:VEVENT').slice(1);
  expect(events.length).toBeGreaterThan(0);
  const nos = events.map((e) => Number(/UID:round-(\d+)-/.exec(e)![1]));
  expect(new Set(nos).size).toBe(nos.length); // one event per round
  for (const e of events) {
    const start = /DTSTART:(\d{8}T\d{6}Z)/.exec(e)![1]!;
    const end = /DTEND:(\d{8}T\d{6}Z)/.exec(e)![1]!;
    expect(start < end).toBe(true);
  }
});
