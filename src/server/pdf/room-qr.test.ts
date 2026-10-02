import { describe, expect, test } from 'vitest';
import { QR_PER_PAGE, roomQrSheetHtml, type RoomQrTile } from './template.ts';
import { roomUrl } from '../services/room-qr.service.ts';

const tile = (n: number): RoomQrTile => ({
  roomNumber: String(100 + n),
  building: 'อาคาร <1>',
  floor: n % 3,
  classLabel: n === 0 ? null : `ม.1 Room${n}`,
  qrSvg: `<svg data-room="${100 + n}"></svg>`,
});

describe('room QR sheet (T34)', () => {
  test('12 cards per A4 page; 13 rooms → 2 pages with 12 + 1', () => {
    expect(QR_PER_PAGE).toBe(12);
    const html = roomQrSheetHtml(
      Array.from({ length: 13 }, (_, i) => tile(i)),
      { termLabel: 'ภาคเรียนที่ 2/2569', generatedAt: 'x' },
      '',
    );
    const pages = html.split('data-pdf-page').slice(1);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.match(/class="card"/g)).toHaveLength(12);
    expect(pages[1]!.match(/class="card"/g)).toHaveLength(1);
    expect(html).toContain('หน้า 2/2');
    expect(html).toContain('@page { size: A4; margin: 0; }');
  });

  test('room number, escaped building and floor, the class (or "–"), and the QR markup itself', () => {
    const html = roomQrSheetHtml([tile(0), tile(4)], { termLabel: '', generatedAt: '' }, '');
    expect(html).toContain('<div class="no">100</div>');
    expect(html).toContain('อาคาร &lt;1&gt; · ชั้น 0');
    expect(html).toContain('<div class="cls">–</div>');
    expect(html).toContain('<div class="cls">ม.1 Room4</div>');
    expect(html).toContain('<svg data-room="104"></svg>');
  });

  test('the QR points at the door URL of the app', () => {
    expect(roomUrl('https://zerowaste.azizstan.net/', 'tok_123')).toBe('https://zerowaste.azizstan.net/r/tok_123');
  });
});
