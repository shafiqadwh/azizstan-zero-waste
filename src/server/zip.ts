/**
 * Minimal ZIP writer (stored, no compression) for the term archive (BR-D2): PDFs are already compressed, so
 * "store" costs little and needs no dependency. Streams one entry at a time, so memory holds one file at most.
 * UTF-8 names (flag bit 11) keep Thai file names readable. No ZIP64: an archive must stay under 4 GiB.
 */
import { crc32 } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  modified?: Date;
}

const UTF8 = 0x0800;
const encoder = new TextEncoder();

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface Central {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

function localHeader(c: Central): Uint8Array {
  const b = Buffer.alloc(30 + c.name.length);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(20, 4); // version needed
  b.writeUInt16LE(UTF8, 6);
  b.writeUInt16LE(0, 8); // stored
  b.writeUInt16LE(c.time, 10);
  b.writeUInt16LE(c.date, 12);
  b.writeUInt32LE(c.crc, 14);
  b.writeUInt32LE(c.size, 18);
  b.writeUInt32LE(c.size, 22);
  b.writeUInt16LE(c.name.length, 26);
  b.writeUInt16LE(0, 28);
  b.set(c.name, 30);
  return b;
}

function centralHeader(c: Central): Uint8Array {
  const b = Buffer.alloc(46 + c.name.length);
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE(20, 4); // made by
  b.writeUInt16LE(20, 6); // needed
  b.writeUInt16LE(UTF8, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(c.time, 12);
  b.writeUInt16LE(c.date, 14);
  b.writeUInt32LE(c.crc, 16);
  b.writeUInt32LE(c.size, 20);
  b.writeUInt32LE(c.size, 24);
  b.writeUInt16LE(c.name.length, 28);
  // extra, comment, disk, internal attrs, external attrs = 0
  b.writeUInt32LE(c.offset, 42);
  b.set(c.name, 46);
  return b;
}

function endRecord(count: number, size: number, offset: number): Uint8Array {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(0x06054b50, 0);
  b.writeUInt16LE(count, 8);
  b.writeUInt16LE(count, 10);
  b.writeUInt32LE(size, 12);
  b.writeUInt32LE(offset, 16);
  return b;
}

/** A ZIP archive as a byte stream; `entries` is pulled lazily, one file per pull. */
export function zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): ReadableStream<Uint8Array> {
  const iterator =
    Symbol.asyncIterator in entries
      ? (entries as AsyncIterable<ZipEntry>)[Symbol.asyncIterator]()
      : (async function* () {
          yield* entries as Iterable<ZipEntry>;
        })();
  const central: Central[] = [];
  let offset = 0;
  let done = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;
      const next = await iterator.next();
      if (!next.done) {
        const e = next.value;
        const c: Central = {
          name: encoder.encode(e.name),
          crc: crc32(e.data) >>> 0,
          size: e.data.length,
          offset,
          ...dosDateTime(e.modified ?? new Date()),
        };
        const header = localHeader(c);
        controller.enqueue(header);
        controller.enqueue(e.data);
        offset += header.length + e.data.length;
        central.push(c);
        if (offset > 0xffff_ffff || central.length > 0xffff) throw new Error('archive too large for ZIP without ZIP64');
        return;
      }
      done = true;
      let size = 0;
      for (const c of central) {
        const h = centralHeader(c);
        controller.enqueue(h);
        size += h.length;
      }
      controller.enqueue(endRecord(central.length, size, offset));
      controller.close();
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}
