import { formatTermLabel } from '@/lib/dates';

const STATUS: Record<string, string> = { active: 'เปิดใช้', draft: 'ร่าง', closed: 'ปิดแล้ว' };

/** Plain GET form: works without JavaScript. */
export function TermPicker({
  terms,
  selectedId,
}: {
  terms: { id: string; academicYear: number; termNo: number; status: string }[];
  selectedId: string;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor="term-picker" className="text-[13px] font-semibold">
          ภาคเรียนที่ตั้งค่า
        </label>
        <select
          id="term-picker"
          name="term"
          defaultValue={selectedId}
          className="h-11 rounded-md border border-line-strong bg-surface px-3 text-[16px]"
        >
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {formatTermLabel(t.termNo, t.academicYear)} · {STATUS[t.status] ?? t.status}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="h-11 rounded-md border border-line-strong bg-surface px-3 text-[14px] font-medium"
      >
        เปิด
      </button>
    </form>
  );
}
