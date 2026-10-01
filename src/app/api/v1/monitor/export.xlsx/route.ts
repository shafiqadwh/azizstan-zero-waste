import ExcelJS from 'exceljs';
import { formatThaiDateTime } from '@/lib/dates';
import { requireUser } from '@/server/auth/current-user';
import { getDb } from '@/server/db';
import { toAppError } from '@/server/errors';
import { COUNTER_LABEL, getBoard, parseBoardQuery, type BoardRow } from '@/server/services/monitor.service';

export const dynamic = 'force-dynamic';

const STATUS: Record<BoardRow['status'], string> = {
  not_evaluated: COUNTER_LABEL.not_evaluated,
  submitted: COUNTER_LABEL.submitted,
  returned: COUNTER_LABEL.returned,
  approved: COUNTER_LABEL.approved,
};
const PDF: Record<BoardRow['pdfStatus'], string> = {
  none: '',
  queued: 'กำลังสร้าง',
  ready: 'พร้อม',
  failed: 'ล้มเหลว',
};

/** GET /api/v1/monitor/export.xlsx?… — the rows visible on `/monitor` with the same filters and scope (§6.17). */
export async function GET(request: Request) {
  try {
    const board = await getBoard(
      getDb(),
      await requireUser(),
      parseBoardQuery(new URL(request.url).searchParams),
      new Date(),
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(board.round ? `รอบที่ ${board.round.roundNo}` : 'monitor');
    ws.addRow(['ห้อง/พื้นที่', 'ส่วนคะแนน', 'กรรมการ', 'ผู้ประเมิน', 'เวลาส่ง', 'สถานะ', 'คะแนน', 'PDF', 'คำขอค้าง']);
    for (const r of board.rows) {
      ws.addRow([
        r.target.roomNumber ? `${r.target.roomNumber} · ${r.target.label}` : r.target.label,
        r.componentLabel,
        r.committee.map((c) => c.name).join(', '),
        r.ownerName ?? '',
        r.submittedAt ? formatThaiDateTime(r.submittedAt) : '',
        r.late ? 'เลยกำหนด' : STATUS[r.status],
        r.score ?? '',
        PDF[r.pdfStatus],
        r.waitingRequest ?? '',
      ]);
    }
    ws.columns.forEach((c) => (c.width = 22));
    ws.getRow(1).font = { bold: true };
    const body = await wb.xlsx.writeBuffer();
    return new Response(body as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="monitor-round-${board.round?.roundNo ?? 0}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const appError = toAppError(err);
    if (!appError) throw err;
    return Response.json({ error: appError.toBody() }, { status: appError.httpStatus });
  }
}
