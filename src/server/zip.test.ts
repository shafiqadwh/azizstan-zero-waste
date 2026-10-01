import { crc32 } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { zipStream } from './zip.ts';

const bytes = async (s: ReadableStream<Uint8Array>) => Buffer.from(await new Response(s).arrayBuffer());

describe('zipStream (stored ZIP for the term archive)', () => {
  test('local headers, central directory and end record agree; names are UTF-8', async () => {
    const data = Buffer.from('%PDF-1.7 hello');
    const buf = await bytes(
      zipStream([
        { name: 'รอบ1/ZW-2569-2-R1-0001_v1.pdf', data, modified: new Date(2026, 9, 1, 10, 30, 0) },
        { name: 'b.txt', data: new Uint8Array() },
      ]),
    );
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const end = buf.length - 22;
    expect(buf.readUInt32LE(end)).toBe(0x06054b50);
    expect(buf.readUInt16LE(end + 10)).toBe(2);
    const cd = buf.readUInt32LE(end + 16);
    expect(buf.readUInt32LE(cd)).toBe(0x02014b50);
    expect(buf.readUInt16LE(cd + 8) & 0x0800).toBe(0x0800);
    expect(buf.readUInt32LE(cd + 16)).toBe(crc32(data) >>> 0);
    const nameLen = buf.readUInt16LE(cd + 28);
    expect(buf.subarray(cd + 46, cd + 46 + nameLen).toString('utf8')).toBe('รอบ1/ZW-2569-2-R1-0001_v1.pdf');
    expect(buf.subarray(30 + nameLen, 30 + nameLen + data.length)).toEqual(data);
    expect(buf.readUInt32LE(end + 12)).toBe(end - cd); // central directory size
  });

  test('an empty archive is just the end record', async () => {
    const buf = await bytes(zipStream([]));
    expect(buf.length).toBe(22);
    expect(buf.readUInt32LE(0)).toBe(0x06054b50);
  });
});
