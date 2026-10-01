import ExcelJS from 'exceljs';
import { getCurrentUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { AppError, notFound, toAppError } from '@/server/errors';
import { assertCan } from '@/server/policies';
import { getPp5Classes, getPp5Students } from '@/server/services/pp5.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/exports/terms/{termId} — the ปพ.5 fallback (FR-I4): the term's results as Excel, finalized rounds
 * only. Sheet "ห้องเรียน" per class; sheet "นักเรียน" by student code when rosters exist. Staff only.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ termId: string }> }) {
  const { termId } = await params;
  try {
    const user = await getCurrentUser();
    if (!user) throw new AppError('UNAUTHENTICATED');
    assertCan(user, 'staff.read');
    if (!/^[0-9a-f-]{36}$/i.test(termId)) throw notFound();
    const db = getDb();
    const now = new Date();
    const data = await getPp5Classes(db, termId, now);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ห้องเรียน');
    const rounds = data.roundsFinalized;
    ws.addRow([
      'ชั้น',
      'ห้องเรียน',
      'ชื่อในระบบนักเรียน',
      ...rounds.flatMap((n) => [`รอบ ${n} ห้อง`, `รอบ ${n} อาคาร/โซน`, `รอบ ${n} รวม`]),
      `คะแนนภาคเรียน (เต็ม ${data.finalMax})`,
    ]);
    for (const c of data.classes) {
      ws.addRow([
        c.grade,
        c.display,
        c.sourceClassKey,
        ...rounds.flatMap((n) => {
          const r = c.rounds.find((x) => x.roundNo === n);
          return [r?.classScore ?? '', r?.areaScore ?? '', r?.total ?? ''];
        }),
        c.termScore ?? '',
      ]);
    }
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col) => (col.width = 18));
    const info = wb.addWorksheet('ข้อมูล');
    info.addRows([
      ['ปีการศึกษา', data.academicYear],
      ['ภาคเรียน', data.termNo],
      ['รอบที่ปิดแล้ว', rounds.join(', ') || '–'],
      ['รอบทั้งหมด', data.roundsTotal],
      ['ครบทุกรอบ', data.termComplete ? 'ใช่' : 'ยังไม่ครบ — ยังไม่ใช่ผลสุดท้าย'],
      ['สร้างเมื่อ', data.generatedAt],
    ]);
    try {
      const st = await getPp5Students(db, termId, now);
      const s = wb.addWorksheet('นักเรียน');
      s.addRow(['รหัสนักเรียน', 'ห้องเรียน', ...st.roundsFinalized.map((n) => `รอบ ${n}`), 'คะแนนภาคเรียน']);
      for (const x of st.students)
        s.addRow([
          x.studentCode,
          x.homeClassKey ?? '',
          ...st.roundsFinalized.map((n) => x.rounds.find((r) => r.roundNo === n)?.total ?? ''),
          x.termScore ?? '',
        ]);
      s.getRow(1).font = { bold: true };
    } catch (err) {
      if (!(err instanceof AppError && err.code === 'NOT_AVAILABLE')) throw err;
    }
    const body = await wb.xlsx.writeBuffer();
    return new Response(body as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="results-${data.academicYear}-${data.termNo}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
