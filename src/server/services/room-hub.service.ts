/**
 * Room hub (2026-10-02): what the door QR (`/r/{qrToken}`) opens for anyone — the room, the class in it today and
 * the services offered for the room. Today: the cleanliness evaluation (Zero Waste). IT and facility issue
 * reporting are planned services sharing the same QR. Public: never names, only room/class/building labels.
 */
import type { Db } from '../../../db/client.ts';
import { bangkokDateString } from '../../lib/dates/index.ts';
import type { SessionUser } from '../policies/index.ts';
import * as places from '../repositories/places.repository.ts';
import { hrefForRoomQr } from './task.service.ts';

export interface RoomHub {
  roomNumber: string;
  building: string | null;
  floor: number | null;
  /** the class linked to the room today, if it takes part in the active term */
  classId: string | null;
  classLabel: string | null;
  /**
   * The cleanliness-evaluation button: `evaluate` (form), `view` (already evaluated — the detail), `login`
   * (signed out), `none` (signed in, no task for this room in the current round).
   */
  evaluation: { kind: 'evaluate' | 'view'; href: string } | { kind: 'login' | 'none' };
}

export async function getRoomHub(
  db: Db,
  qrToken: string,
  viewer: SessionUser | null,
  now: Date,
): Promise<RoomHub | null> {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(qrToken)) return null;
  const room = await places.findRoomByQrToken(db, qrToken);
  if (!room || !room.isActive) return null;
  const building = await places.findArea(db, room.buildingId);
  const link = await places.linkOfRoomOnDate(db, room.id, bangkokDateString(now));
  const term = await places.findActiveTerm(db);
  const inTerm = link && term ? (await places.listTermClassIds(db, term.id)).includes(link.classId) : false;
  const cls = link && inTerm ? await places.findClass(db, link.classId) : null;

  let evaluation: RoomHub['evaluation'];
  if (!viewer) evaluation = { kind: 'login' };
  else {
    const href = await hrefForRoomQr(db, viewer, qrToken, now);
    evaluation = !href ? { kind: 'none' } : { kind: href.startsWith('/evaluate/new') ? 'evaluate' : 'view', href };
  }
  return {
    roomNumber: room.roomNumber,
    building: building?.name ?? null,
    floor: room.floor,
    classId: cls?.id ?? null,
    classLabel: cls?.displayName ?? null,
    evaluation,
  };
}
