import { AlertTriangle, Check, Circle, Clock, Undo2, type LucideIcon } from 'lucide-react';

export type PillStatus = 'not_evaluated' | 'submitted' | 'returned' | 'approved' | 'late' | 'void';

/** 08-ux-ui §4.4 — icon + text, never colour alone; labels from §9. */
const PILL: Record<PillStatus, { icon: LucideIcon; label: string; cls: string }> = {
  not_evaluated: { icon: Circle, label: 'ยังไม่ประเมิน', cls: 'bg-surface-muted text-[#3D4641]' },
  submitted: { icon: Clock, label: 'รออนุมัติ', cls: 'bg-warn-soft text-warn-ink' },
  returned: { icon: Undo2, label: 'ส่งกลับให้แก้', cls: 'bg-danger-soft text-danger-ink' },
  approved: { icon: Check, label: 'อนุมัติแล้ว', cls: 'bg-brand-soft text-brand-ink' },
  late: { icon: AlertTriangle, label: 'เลยกำหนด', cls: 'bg-danger-soft text-danger-ink' },
  void: { icon: Circle, label: 'ลบแล้ว', cls: 'bg-surface-muted text-ink-muted' },
};

export function StatusPill({ status }: { status: PillStatus }) {
  const { icon: Icon, label, cls } = PILL[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold whitespace-nowrap ${cls}`}
    >
      <Icon size={14} aria-hidden strokeWidth={2} />
      {label}
    </span>
  );
}
