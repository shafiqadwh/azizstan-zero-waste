import { toAppError, type ErrorBody } from './errors.ts';

/** Return type of every server action (05-api §1). */
export type Result<T> = { ok: true; data: T } | { ok: false; error: ErrorBody };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

/**
 * Run a server-action body and turn expected failures (AppError, ZodError) into `{ ok: false }`.
 * Unexpected errors are rethrown so they surface as bugs instead of a misleading Thai message.
 */
export async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return { ok: false, error: appError.toBody() };
  }
}

/** Same mapping for REST route handlers: expected failures become `{ error }` with the code's HTTP status. */
export async function toResponse<T>(fn: () => Promise<T>, init?: ResponseInit): Promise<Response> {
  try {
    return Response.json(await fn(), init);
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
