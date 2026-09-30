import { expect, test } from 'vitest';
import { evaluateHealth, HEARTBEAT_STALE_AFTER_S } from './health.ts';

const now = new Date('2026-11-16T01:00:00Z');
const ago = (s: number) => new Date(now.getTime() - s * 1000);

test('ok when the database answers and the worker beat recently', () => {
  expect(evaluateHealth({ dbOk: true, heartbeatAt: ago(12), now })).toEqual({
    status: 'ok',
    db: 'ok',
    worker: { lastHeartbeatAt: ago(12).toISOString(), ageSeconds: 12, status: 'ok' },
  });
});

test('degraded when the heartbeat is stale or missing', () => {
  expect(evaluateHealth({ dbOk: true, heartbeatAt: ago(HEARTBEAT_STALE_AFTER_S + 1), now }).status).toBe('degraded');
  expect(evaluateHealth({ dbOk: true, heartbeatAt: null, now })).toMatchObject({
    status: 'degraded',
    worker: { status: 'missing', ageSeconds: null },
  });
});

test('down when the database is unreachable', () => {
  expect(evaluateHealth({ dbOk: false, heartbeatAt: null, now })).toMatchObject({ status: 'down', db: 'error' });
});
