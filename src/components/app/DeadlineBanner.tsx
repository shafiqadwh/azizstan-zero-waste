import { AlertTriangle, Clock } from 'lucide-react';
import { formatThaiDateTime } from '@/lib/dates';

const HOUR = 3600_000;

/** "3 วัน" / "5 ชั่วโมง" / "20 นาที" — whole units, rounded down. */
export function formatRemaining(ms: number): string {
  if (ms >= 24 * HOUR) return `${Math.floor(ms / (24 * HOUR))} วัน`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} ชั่วโมง`;
  return `${Math.max(1, Math.floor(ms / 60_000))} นาที`;
}

/** 07-frontend §5 / 08-ux-ui §6.7: amber within 72 h of closing, red after close. */
export function DeadlineBanner({
  round,
  now,
}: {
  round: { roundNo: number; status: string; opensAt: Date; closesAt: Date; entryOpen: boolean };
  now: Date;
}) {
  if (round.status === 'scheduled' || now < round.opensAt) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-surface-muted px-4 py-3 text-[14px]">
        <Clock size={18} aria-hidden /> รอบที่ {round.roundNo} เริ่ม {formatThaiDateTime(round.opensAt)}
      </p>
    );
  }
  if (!round.entryOpen) {
    return (
      <p
        role="alert"
        className="flex items-center gap-2 rounded-lg bg-danger-soft px-4 py-3 text-[14px] text-danger-ink"
      >
        <AlertTriangle size={18} aria-hidden /> รอบที่ {round.roundNo} · เลยกำหนดแล้ว · ต้องขออนุมัติก่อนใส่คะแนน
      </p>
    );
  }
  const left = round.closesAt.getTime() - now.getTime();
  const urgent = left < 72 * HOUR;
  return (
    <p
      className={`flex items-center gap-2 rounded-lg px-4 py-3 text-[14px] ${urgent ? 'bg-warn-soft text-warn-ink' : 'bg-brand-soft text-brand-ink'}`}
    >
      <Clock size={18} aria-hidden /> รอบที่ {round.roundNo} · เหลือเวลาลงคะแนน {formatRemaining(left)}
    </p>
  );
}
