import { ZodError } from 'zod';

/** Error codes and their HTTP status and Thai UI message (05-api §1). `{x}` is filled from `params`. */
export const ERRORS = {
  UNAUTHENTICATED: { http: 401, message: 'กรุณาเข้าสู่ระบบอีกครั้ง' },
  FORBIDDEN: { http: 403, message: 'คุณไม่มีสิทธิ์ทำรายการนี้' },
  NOT_FOUND: { http: 404, message: 'ไม่พบข้อมูล' },
  VALIDATION: { http: 422, message: 'ข้อมูลไม่ถูกต้อง' },
  ALREADY_EVALUATED: { http: 409, message: 'ห้องนี้ประเมินแล้วโดย {name} เมื่อ {time}' },
  ENTRY_CLOSED: { http: 409, message: 'เลยกำหนดใส่คะแนนแล้ว กด "ขออนุมัติใส่คะแนน"' },
  EDIT_WINDOW_PASSED: { http: 409, message: 'เกิน 24 ชั่วโมงแล้ว กด "ขออนุมัติแก้ไข"' },
  CONFIG_LOCKED: { http: 409, message: 'เทอมนี้มีผลประเมินแล้ว แก้การตั้งค่าไม่ได้' },
  ROUND_NOT_COMPLETE: { http: 409, message: 'ยังปิดรอบไม่ได้ เหลือ {n} รายการ' },
  CONFLICT: { http: 409, message: 'มีคนแก้ไขข้อมูลนี้ก่อนหน้า กรุณาโหลดใหม่' },
  RATE_LIMITED: { http: 429, message: 'ลองใหม่อีกครั้งในอีกสักครู่' },
  NOT_AVAILABLE: { http: 404, message: 'ยังไม่มีข้อมูลรายนักเรียนในภาคเรียนนี้' },
} as const satisfies Record<string, { http: number; message: string }>;

export type ErrorCode = keyof typeof ERRORS;
export type ErrorParams = Record<string, string | number>;

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  field?: string;
}

/** Fill `{name}` placeholders; unknown placeholders stay as written so a missing param is visible, not blank. */
export function fillMessage(template: string, params: ErrorParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in params ? String(params[key]) : m));
}

/**
 * The only error type services throw for expected failures. Anything else is a bug and propagates
 * (it is logged by the framework and never shown to the user as-is).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly params?: ErrorParams;

  constructor(code: ErrorCode, opts: { message?: string; field?: string; params?: ErrorParams } = {}) {
    const message = opts.message ?? fillMessage(ERRORS[code].message, opts.params);
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.field = opts.field;
    this.params = opts.params;
  }

  get httpStatus(): number {
    return ERRORS[this.code].http;
  }

  toBody(): ErrorBody {
    return { code: this.code, message: this.message, ...(this.field ? { field: this.field } : {}) };
  }
}

/** Shorthands for the common cases. */
export const forbidden = () => new AppError('FORBIDDEN');
export const notFound = () => new AppError('NOT_FOUND');
export const unauthenticated = () => new AppError('UNAUTHENTICATED');
export const validation = (field: string, message: string) => new AppError('VALIDATION', { field, message });

/**
 * Map a thrown value to an AppError: AppError as is; ZodError → VALIDATION on its first issue (field = dotted path).
 * Returns null for anything else so callers rethrow it.
 */
export function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.join('.') : undefined;
    return new AppError('VALIDATION', { field, message: issue?.message ?? ERRORS.VALIDATION.message });
  }
  return null;
}

/** Validate service input with Zod; failures become AppError VALIDATION (field = dotted path of the first issue). */
export function parseInput<S extends { parse: (v: unknown) => unknown }>(
  schema: S,
  raw: unknown,
): ReturnType<S['parse']> {
  try {
    return schema.parse(raw) as ReturnType<S['parse']>;
  } catch (err) {
    throw toAppError(err) ?? err;
  }
}
