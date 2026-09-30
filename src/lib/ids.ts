import { randomBytes } from 'node:crypto';

/**
 * UUID v7 (RFC 9562): 48-bit Unix ms timestamp + random bits. Time-ordered, so primary-key inserts stay
 * append-friendly. All ids in the schema come from here (db/schema.ts conventions).
 */
export function newId(now: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = 0x70 | (b[6]! & 0x0f); // version 7
  b[8] = 0x80 | (b[8]! & 0x3f); // variant 10
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
