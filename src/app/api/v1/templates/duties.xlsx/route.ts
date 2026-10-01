import ExcelJS from 'exceljs';
import { getCurrentUser } from '@/server/auth/current-user';
import { can } from '@/server/policies';

export const dynamic = 'force-dynamic';

/** GET /api/v1/templates/duties.xlsx — template with example rows (10-integrations §4.1). Admins only. */
export async function GET() {
  const user = await getCurrentUser();
  if (!can(user, 'duty.manage')) return new Response(null, { status: user ? 403 : 401 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('duties');
  ws.addRow(['username', 'ชื่อ (ไม่ใช้ในการนำเข้า)', 'หน้าที่', 'ประเภทเป้าหมาย', 'เป้าหมาย']);
  ws.addRow(['t.kamal', 'ครูกามัล', 'committee', 'อาคาร', '1']);
  ws.addRow(['t.kamal', 'ครูกามัล', 'committee', 'ห้อง', '121']);
  ws.addRow(['t.kamal', 'ครูกามัล', 'committee', 'ห้อง', 'ม.1 Usaha']);
  ws.addRow(['adm', 'ผู้ดูแล', 'approver', '', '']);
  ws.columns.forEach((c) => (c.width = 20));
  ws.getRow(1).font = { bold: true };
  const body = await wb.xlsx.writeBuffer();
  return new Response(body as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="duties.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
