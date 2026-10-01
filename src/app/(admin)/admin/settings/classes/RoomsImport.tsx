'use client';

import { Download, FileUp } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import type { Result } from '@/server/result';
import type { ImportReport } from '@/server/services/rooms-import.service';
import { importRoomsAction } from './actions';
import { buttonClass, primaryClass } from './ui';

/** rooms.xlsx: check first (nothing saved), then import the same file (10-integrations §4.2). */
export function RoomsImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Result<ImportReport> | null>(null);
  const [pending, start] = useTransition();

  const send = (commit: boolean) => {
    const file = fileRef.current?.files?.[0];
    const fd = new FormData();
    if (file) fd.set('file', file);
    if (commit) fd.set('commit', '1');
    start(async () => setResult(await importRoomsAction(fd)));
  };

  const report = result?.ok ? result.data : null;
  const canCommit = report && !report.committed && report.summary.errors === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="rooms-file" className="text-[13px] font-semibold">
            ไฟล์ rooms.xlsx
          </label>
          <input
            id="rooms-file"
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={() => setResult(null)}
            className="min-w-0 text-[14px]"
          />
        </div>
        <a href="/api/v1/templates/rooms.xlsx" className={`${buttonClass} inline-flex items-center gap-1.5`}>
          <Download size={16} aria-hidden /> แม่แบบ
        </a>
        <button
          type="button"
          disabled={pending}
          onClick={() => send(false)}
          className={`${buttonClass} inline-flex items-center gap-1.5`}
        >
          <FileUp size={16} aria-hidden /> ตรวจสอบไฟล์ (ยังไม่บันทึก)
        </button>
        {canCommit ? (
          <button type="button" disabled={pending} onClick={() => send(true)} className={primaryClass}>
            นำเข้า
          </button>
        ) : null}
      </div>
      {pending ? <p className="text-[13px] text-ink-muted">กำลังอ่านไฟล์…</p> : null}
      {result && !result.ok ? (
        <p role="alert" className="text-[13px] text-danger-ink">
          {result.error.message}
        </p>
      ) : null}
      {report ? (
        <div role="status" className="rounded-md border border-line p-3 text-[14px]">
          <p className="font-semibold">
            {report.committed
              ? 'นำเข้าแล้ว'
              : report.summary.errors > 0
                ? `พบ ${report.summary.errors} แถวที่ผิด ยังไม่ได้นำเข้า`
                : 'ตรวจแล้ว ยังไม่ได้บันทึก กด "นำเข้า" เพื่อบันทึก'}
          </p>
          <p className="text-ink-muted">
            อาคารใหม่ {report.summary.buildingsCreated} · ห้องใหม่ {report.summary.roomsCreated} · แก้ไขห้อง{' '}
            {report.summary.roomsUpdated} · ผูกห้องเรียน {report.summary.links}
          </p>
          <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-auto">
            {report.rows.map((r) => (
              <li key={r.line} className={r.error ? 'text-danger-ink' : ''}>
                แถว {r.line} · ห้อง {r.roomNumber || '–'}: {r.error ?? r.actions.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
