import { describe, expect, test } from 'vitest';
import { assertPublicRate, assertSameOrigin, callerIp } from './http-guards.ts';
import { SlidingWindowLimiter } from './rate-limit.ts';

const req = (headers: Record<string, string>, url = 'https://zerowaste.azizstan.net/api/v1/uploads') =>
  new Request(url, { method: 'POST', headers });

describe('assertSameOrigin (CSRF for REST mutations)', () => {
  const app = 'https://zerowaste.azizstan.net';
  test('APP_URL origin passes', () => {
    expect(() => assertSameOrigin(req({ origin: app, host: 'zerowaste.azizstan.net' }), app)).not.toThrow();
  });
  test('the host the request was sent to passes (LAN by IP, local dev)', () => {
    expect(() =>
      assertSameOrigin(
        req({ origin: 'http://192.168.1.5:3000', host: '192.168.1.5:3000' }, 'http://192.168.1.5:3000/x'),
        app,
      ),
    ).not.toThrow();
  });
  test('another site, a look-alike or a missing Origin is refused', () => {
    for (const origin of ['https://evil.example', 'https://zerowaste.azizstan.net.evil.example', 'null'])
      expect(() => assertSameOrigin(req({ origin, host: 'zerowaste.azizstan.net' }), app)).toThrow(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    expect(() => assertSameOrigin(req({ host: 'zerowaste.azizstan.net' }), app)).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});

describe('public API rate limit', () => {
  test('60 per minute per IP, then RATE_LIMITED; other IPs and the next minute are unaffected', () => {
    const limiter = new SlidingWindowLimiter(60, 60_000);
    const t0 = new Date('2026-10-01T03:00:00Z');
    const a = req({ 'cf-connecting-ip': '203.0.113.1' });
    for (let i = 0; i < 60; i++) assertPublicRate(a, t0, limiter);
    expect(() => assertPublicRate(a, t0, limiter)).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }));
    expect(() => assertPublicRate(req({ 'cf-connecting-ip': '203.0.113.2' }), t0, limiter)).not.toThrow();
    expect(() => assertPublicRate(a, new Date(t0.getTime() + 60_001), limiter)).not.toThrow();
  });
  test('callerIp prefers Cloudflare, then the first forwarded address', () => {
    expect(callerIp(req({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1');
    expect(callerIp(req({ 'x-forwarded-for': '2.2.2.2, 10.0.0.1' }))).toBe('2.2.2.2');
    expect(callerIp(req({}))).toBe('unknown');
  });
});
