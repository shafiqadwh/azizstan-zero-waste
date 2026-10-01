'use client';

import { Download, FileUp } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { buttonCls, primaryCls } from '@/components/app/settings';
import type { Result } from '@/server/result';
import type { DutyImportReport } from '@/server/services/duties-import.service';
import { importDutiesAction } from './actions';

/** duties.xlsx: download template → upload → dry-run report → ยืนยันนำเข้า (08-ux-ui §6.13). */
export function DutiesImport({ termId }: { termId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Result<DutyImportReport> | null>(null);
  const [pending, start] = useTransition();

  const send = (commit: boolean) => {
    const file = fileRef.current?.files?.[0];
    const fd = new FormData();
    fd.set('termId', termId);
    if (file) fd.set('file', file);
    if (commit) fd.set('commit', '1');
    start(async () => setResult(await importDutiesAction(fd)));
  };

  const report = result?.ok ? result.data : null;
  const canCommit = report && !report.committed && report.summary.errors === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="duties-file" className="text-[13px] font-semibold">
            ไฟล์ duties.xlsx
          </label>
          <input
            id="duties-file"
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={() => setResult(null)}
            className="min-w-0 text-[14px]"
          />
        </div>
        <a href="/api/v1/templates/duties.xlsx" className={`${buttonCls} inline-flex items-center gap-1.5`}>
          <Download size={16} aria-hidden /> แม่แบบ
        </a>
        <button
          type="button"
          disabled={pending}
          onClick={() => send(false)}
          className={`${buttonCls} inline-flex items-center gap-1.5`}
        >
          <FileUp size={16} aria-hidden /> ตรวจสอบไฟล์ (ยังไม่บันทึก)
        </button>
        {canCommit ? (
          <button type="button" disabled={pending} onClick={() => send(true)} className={primaryCls}>
            ยืนยันนำเข้า
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
                : 'ตรวจแล้ว ยังไม่ได้บันทึก กด "ยืนยันนำเข้า" เพื่อบันทึก'}
          </p>
          <p className="text-ink-muted">
            มอบหมายใหม่ {report.summary.created} · มีอยู่แล้ว {report.summary.existing} · เปิดบัญชีครู{' '}
            {report.summary.enabledUsers}
          </p>
          {report.uncovered.length > 0 ? (
            <p className="mt-1 text-danger-ink">
              ยังไม่มีผู้ประเมิน {report.uncovered.length} รายการ: {report.uncovered.join(', ')}
            </p>
          ) : (
            <p className="mt-1 text-brand-ink">ทุกห้องเรียนและพื้นที่มีผู้ประเมินแล้ว</p>
          )}
          <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-auto">
            {report.rows.map((r) => (
              <li key={r.line} className={r.error ? 'text-danger-ink' : ''}>
                แถว {r.line} · {r.username || '–'} → {r.target || 'ทุกรายการ'}: {r.error ?? r.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
