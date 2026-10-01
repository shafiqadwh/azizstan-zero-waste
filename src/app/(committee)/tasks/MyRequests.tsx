import Link from 'next/link';
import { TargetBadge } from '@/components/app/TargetBadge';
import { formatThaiDateTime } from '@/lib/dates';
import { REQUEST_STATUS_LABEL, type MyRequest } from '@/server/services/request.service';

const PILL: Record<MyRequest['status'], string> = {
  waiting: 'bg-warn-soft text-warn-ink',
  approved: 'bg-brand-soft text-brand-ink',
  rejected: 'bg-danger-soft text-danger-ink',
  expired: 'bg-surface-muted text-ink-muted',
  cancelled: 'bg-surface-muted text-ink-muted',
};

/** 08-ux-ui §6.19 "คำขอของฉัน": status pills, the decision note, and the late-entry countdown with the form link. */
export function MyRequests({ requests }: { requests: MyRequest[] }) {
  if (requests.length === 0)
    return <p className="rounded-lg border border-line bg-surface px-5 py-6 text-center">คุณยังไม่มีคำขอ</p>;
  return (
    <ul className="flex flex-col gap-3">
      {requests.map((r) => (
        <li
          key={r.id}
          className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4"
          data-testid={`my-request-${r.target.label}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{r.typeLabel}</span>
            <TargetBadge roomNumber={r.target.roomNumber} label={r.target.label} />
            <span className={`ml-auto rounded-full px-2.5 py-1 text-[13px] font-semibold ${PILL[r.status]}`}>
              {REQUEST_STATUS_LABEL[r.status]}
            </span>
          </div>
          <p className="text-[13px] text-ink-muted">ส่งเมื่อ {formatThaiDateTime(r.createdAt)}</p>
          <p className="text-[14px]">
            {r.oldValue !== null ? (
              <>
                <s className="text-ink-muted">{r.oldValue}</s> → <b>{r.newValue}</b>
              </>
            ) : (
              r.newValue
            )}
          </p>
          {r.decisionNote ? <p className="text-[14px]">หมายเหตุ: {r.decisionNote}</p> : null}
          {r.lateEntry ? (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-[14px] font-semibold text-brand-ink">
                ใส่คะแนนได้อีก {r.lateEntry.hoursLeft} ชม.
              </span>
              <Link
                href={r.lateEntry.href}
                className="inline-flex h-10 items-center rounded-[12px] bg-brand px-4 text-[14px] font-semibold text-white"
              >
                ไปใส่คะแนน
              </Link>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
