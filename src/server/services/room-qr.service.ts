/**
 * T34: printable QR sheet for the physical rooms (08-ux-ui §6.21 "พิมพ์ QR ทุกห้อง"). Each QR is the room's door
 * URL `/r/{qrToken}` (Q6): scanning opens the evaluation form for a signed-in committee member with a duty there.
 * Admins only (the tokens are not secrets, but the sheet is an admin task).
 */
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { bangkokDateString, formatTermLabel, formatThaiDateTime } from '../../lib/dates/index.ts';
import { parseInput } from '../errors.ts';
import { sarabunCss } from '../pdf/fonts.ts';
import { roomQrSheetHtml, type RoomQrTile } from '../pdf/template.ts';
import { assertCan, type SessionUser } from '../policies/index.ts';
import * as places from '../repositories/places.repository.ts';

export const roomQrInput = z.object({
  buildingId: z.uuid().optional(),
  roomId: z.uuid().optional(),
});

export function roomUrl(base: string, qrToken: string): string {
  return `${base.replace(/\/$/, '')}/r/${qrToken}`;
}

export async function roomQrSheet(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof roomQrInput>,
  opts: { baseUrl: string; now: Date },
): Promise<{ html: string; filename: string; count: number }> {
  assertCan(actor, 'place.manage');
  const q = parseInput(roomQrInput, raw);
  const [rooms, areas, classes, links, term] = await Promise.all([
    places.listRooms(db),
    places.listAreas(db),
    places.listClasses(db),
    places.listLinksOnDate(db, bangkokDateString(opts.now)),
    places.findActiveTerm(db),
  ]);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const classOfRoom = new Map(links.map((l) => [l.physicalRoomId, l.classId]));
  const chosen = rooms
    .filter((r) => r.isActive)
    .filter((r) => (q.roomId ? r.id === q.roomId : true))
    .filter((r) => (q.buildingId ? r.buildingId === q.buildingId : true))
    .sort(
      (a, b) =>
        (areaById.get(a.buildingId)?.sortOrder ?? 0) - (areaById.get(b.buildingId)?.sortOrder ?? 0) ||
        (a.floor ?? 0) - (b.floor ?? 0) ||
        a.roomNumber.localeCompare(b.roomNumber, 'th', { numeric: true }),
    );
  const tiles: RoomQrTile[] = [];
  for (const r of chosen) {
    const classId = classOfRoom.get(r.id);
    tiles.push({
      roomNumber: r.roomNumber,
      building: areaById.get(r.buildingId)?.name ?? '–',
      floor: r.floor,
      classLabel: classId ? (classById.get(classId)?.displayName ?? null) : null,
      qrSvg: await QRCode.toString(roomUrl(opts.baseUrl, r.qrToken), {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
      }),
    });
  }
  const html = roomQrSheetHtml(
    tiles,
    {
      termLabel: term ? formatTermLabel(term.termNo, term.academicYear) : '',
      generatedAt: formatThaiDateTime(opts.now),
    },
    await sarabunCss(),
  );
  const which = q.roomId && tiles[0] ? tiles[0].roomNumber : q.buildingId ? 'building' : 'all';
  return { html, filename: `qr-rooms-${which}.pdf`, count: tiles.length };
}
