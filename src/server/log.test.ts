import { describe, expect, test } from 'vitest';
import { formatEntry, redact } from './log.ts';

/** T29 log redaction test (12-security §2 item 6). */
describe('log redaction', () => {
  test('sensitive keys are redacted at any depth, other fields kept', () => {
    const line = JSON.parse(
      formatEntry('info', 'request', {
        headers: { Authorization: 'Bearer zw_pp5_abc', cookie: 'zw_session=s3cret', 'user-agent': 'x' },
        password: 'hunter2',
        body: { newPassword: 'a', apiKey: 'k', sessionId: 'abcd', counts: { rows: 3 } },
        env: { VAPID_PRIVATE_KEY: 'p', STUDENT_API_TOKEN: 't', SESSION_SECRET: 's' },
      }),
    );
    expect(line).toMatchObject({
      level: 'info',
      msg: 'request',
      headers: { Authorization: '[redacted]', cookie: '[redacted]', 'user-agent': 'x' },
      password: '[redacted]',
      body: { newPassword: '[redacted]', apiKey: '[redacted]', sessionId: '[redacted]', counts: { rows: 3 } },
      env: { VAPID_PRIVATE_KEY: '[redacted]', STUDENT_API_TOKEN: '[redacted]', SESSION_SECRET: '[redacted]' },
    });
    const text = JSON.stringify(line);
    for (const secret of ['zw_pp5_abc', 's3cret', 'hunter2', 'abcd']) expect(text).not.toContain(secret);
  });

  test('URL query strings (student API token) are cut, in the message and in errors', () => {
    const url = 'https://school.example/api/students?token=SECRET123&year=2569';
    const line = formatEntry('error', `fetch failed ${url}`, { err: new Error(`GET ${url} → 500`) });
    expect(line).not.toContain('SECRET123');
    expect(line).toContain('https://school.example/api/students?[redacted]');
  });

  test('13-digit runs (national ID shape) are masked; shorter numbers stay', () => {
    expect(redact('id 1234567890123 code 65001')).toBe('id [redacted-13] code 65001');
    expect(redact({ list: ['x1234567890123'] })).toEqual({ list: ['x[redacted-13]'] });
  });

  test('errors keep name, message and stack; cycles and depth are bounded', () => {
    const e = new Error('boom');
    const out = redact({ err: e }) as { err: { name: string; message: string; stack: string } };
    expect(out.err).toMatchObject({ name: 'Error', message: 'boom' });
    const deep: Record<string, unknown> = {};
    let cur = deep;
    for (let i = 0; i < 10; i++) cur = cur.next = {} as Record<string, unknown>;
    expect(JSON.stringify(redact(deep))).toContain('[depth]');
  });
});
