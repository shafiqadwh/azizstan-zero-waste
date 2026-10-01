/**
 * T30 printable signature sheet per class and round (09-pdf §3). Built from the round's frozen class → area
 * mapping, so the sheet shows the room and building the class has in that round. No student names: students
 * sign on the paper, and the photo of the sheet is attached as signature evidence.
 */
import { z } from 'zod';
import type { Db } from '../../../db/client.ts';
import { formatTermLabel, formatThaiDate, formatThaiDateTime } from '../../lib/dates/index.ts';
import { notFound, parseInput } from '../errors.ts';
import { signatureSheetHtml } from '../pdf/template.ts';
import { sarabunCss } from '../pdf/fonts.ts';
import { assertCan, can, type SessionUser } from '../policies/index.ts';
import * as dutiesRepo from '../repositories/duties.repository.ts';
import * as places from '../repositories/places.repository.ts';
import * as roundsRepo from '../repositories/rounds.repository.ts';
import * as termsRepo from '../repositories/terms.repository.ts';

export const signatureSheetInput = z.object({ classId: z.uuid(), roundId: z.uuid() });

/** Staff, or a committee member holding a duty on this class in the round's term (the one who collects it). */
export async function signatureSheetHtmlFor(
  db: Db,
  actor: SessionUser,
  raw: z.input<typeof signatureSheetInput>,
  now: Date,
): Promise<{ html: string; filename: string }> {
  const { classId, roundId } = parseInput(signatureSheetInput, raw);
  const round = await termsRepo.findRound(db, roundId);
  const term = round ? await termsRepo.findTerm(db, round.termId) : null;
  if (!round || !term || term.purgedAt) throw notFound();
  if (!can(actor, 'staff.read')) {
    const hasDuty = await dutiesRepo.hasCommitteeDutyFor(db, term.id, actor.id, { classId }, now);
    assertCan(actor, 'evaluation.create', { hasDuty });
  }
  const link = await roundsRepo.findRoundClassArea(db, roundId, classId);
  const cls = link ? await places.findClass(db, classId) : null;
  if (!link || !cls) throw notFound();
  const [room, area] = await Promise.all([
    link.physicalRoomId ? places.findRoom(db, link.physicalRoomId) : null,
    places.findArea(db, link.areaId),
  ]);
  const html = signatureSheetHtml(
    {
      termLabel: formatTermLabel(term.termNo, term.academicYear),
      target: room ? `${room.roomNumber} · ${cls.displayName}` : cls.displayName,
      place: area?.name ?? null,
      roundNo: round.roundNo,
      roundDates: `${formatThaiDate(round.opensAt)} – ${formatThaiDate(round.closesAt)}`,
      generatedAt: formatThaiDateTime(now),
    },
    await sarabunCss(),
  );
  return {
    html,
    filename: `signature-${term.academicYear}-${term.termNo}-r${round.roundNo}-${room?.roomNumber ?? cls.id.slice(0, 8)}.pdf`,
  };
}
