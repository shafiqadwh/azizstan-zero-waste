import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { AppError, ERRORS, fillMessage, toAppError, type ErrorCode } from './errors.ts';
import { toResponse, toResult } from './result.ts';

describe('error codes (05-api §1)', () => {
  test.each([
    ['UNAUTHENTICATED', 401, 'กรุณาเข้าสู่ระบบอีกครั้ง'],
    ['FORBIDDEN', 403, 'คุณไม่มีสิทธิ์ทำรายการนี้'],
    ['NOT_FOUND', 404, 'ไม่พบข้อมูล'],
    ['VALIDATION', 422, 'ข้อมูลไม่ถูกต้อง'],
    ['ENTRY_CLOSED', 409, 'เลยกำหนดใส่คะแนนแล้ว กด "ขออนุมัติใส่คะแนน"'],
    ['EDIT_WINDOW_PASSED', 409, 'เกิน 24 ชั่วโมงแล้ว กด "ขออนุมัติแก้ไข"'],
    ['CONFIG_LOCKED', 409, 'เทอมนี้มีผลประเมินแล้ว แก้การตั้งค่าไม่ได้'],
    ['CONFLICT', 409, 'มีคนแก้ไขข้อมูลนี้ก่อนหน้า กรุณาโหลดใหม่'],
    ['RATE_LIMITED', 429, 'ลองใหม่อีกครั้งในอีกสักครู่'],
  ] as const)('%s → HTTP %i with its Thai message', (code, http, message) => {
    const e = new AppError(code);
    expect(e.httpStatus).toBe(http);
    expect(e.message).toBe(message);
    expect(e.toBody()).toEqual({ code, message });
  });

  test('every code has an HTTP status and a message', () => {
    for (const code of Object.keys(ERRORS) as ErrorCode[]) {
      expect(ERRORS[code].http).toBeGreaterThanOrEqual(400);
      expect(ERRORS[code].message.length).toBeGreaterThan(0);
    }
  });

  test('fills placeholders', () => {
    expect(
      new AppError('ALREADY_EVALUATED', { params: { name: 'ครูสมชาย', time: '15 พ.ย. 2569 16:30 น.' } }).message,
    ).toBe('ห้องนี้ประเมินแล้วโดย ครูสมชาย เมื่อ 15 พ.ย. 2569 16:30 น.');
    expect(new AppError('ROUND_NOT_COMPLETE', { params: { n: 3 } }).message).toBe('ยังปิดรอบไม่ได้ เหลือ 3 รายการ');
    expect(fillMessage('เหลือ {n} รายการ')).toBe('เหลือ {n} รายการ');
  });
});

describe('mapping thrown values', () => {
  test('ZodError → VALIDATION with the dotted field path of the first issue', () => {
    const schema = z.object({ score: z.object({ value: z.number({ error: 'กรุณาเลือกคะแนน' }) }) });
    const parsed = schema.safeParse({ score: { value: null } });
    expect(parsed.success).toBe(false);
    const e = toAppError(parsed.error);
    expect(e?.toBody()).toEqual({ code: 'VALIDATION', field: 'score.value', message: 'กรุณาเลือกคะแนน' });
  });

  test('unknown errors are not mapped', () => {
    expect(toAppError(new Error('boom'))).toBeNull();
  });

  test('toResult wraps data and expected failures, rethrows bugs', async () => {
    await expect(toResult(async () => 42)).resolves.toEqual({ ok: true, data: 42 });
    await expect(
      toResult(async () => {
        throw new AppError('FORBIDDEN');
      }),
    ).resolves.toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'คุณไม่มีสิทธิ์ทำรายการนี้' } });
    await expect(
      toResult(async () => {
        throw new TypeError('bug');
      }),
    ).rejects.toThrow('bug');
  });

  test('toResponse uses the code HTTP status', async () => {
    const res = await toResponse(async () => {
      throw new AppError('NOT_FOUND');
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'ไม่พบข้อมูล' } });
    expect((await toResponse(async () => ({ a: 1 }))).status).toBe(200);
  });
});
