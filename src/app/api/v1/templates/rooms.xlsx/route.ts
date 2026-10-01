import ExcelJS from 'exceljs';
import { getCurrentUser } from '@/server/auth/current-user';
import { can } from '@/server/policies';
import { HEADERS } from '@/server/services/rooms-import.service';

export const dynamic = 'force-dynamic';

/** GET /api/v1/templates/rooms.xlsx — empty template with one example row (10-integrations §4.2). Admins only. */
export async function GET() {
  const user = await getCurrentUser();
  if (!can(user, 'place.manage')) return new Response(null, { status: user ? 403 : 401 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('rooms');
  ws.addRow([...HEADERS.slice(0, 3), 'ห้องเรียน (optional)', 'มีผลตั้งแต่']);
  ws.addRow(['1', '121', 2, 'ม.1 Amanah', '2026-11-01']);
  ws.columns.forEach((c) => (c.width = 18));
  ws.getRow(1).font = { bold: true };
  const body = await wb.xlsx.writeBuffer();
  return new Response(body as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="rooms.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
