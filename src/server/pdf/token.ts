/** HMAC token for /internal/pdf/* (02-architecture §1): `{expiry}.{sig}` over (evaluationId, expiry), 5 minutes. */
import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 5 * 60_000;

const sign = (secret: string, id: string, exp: number) =>
  createHmac('sha256', secret).update(`${id}.${exp}`).digest('base64url');

export function pdfToken(secret: string, id: string, now: Date): string {
  const exp = now.getTime() + TTL_MS;
  return `${exp}.${sign(secret, id, exp)}`;
}

export function verifyPdfToken(secret: string | undefined, id: string, token: string | null, now: Date): boolean {
  if (!secret || !token) return false;
  const [expText, sig] = token.split('.');
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp < now.getTime() || !sig) return false;
  const want = Buffer.from(sign(secret, id, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
