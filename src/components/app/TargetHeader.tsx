/** 08-ux-ui §4.5: "am I in the right room" — room number square, class (or area) name, building/floor and round. */
export function TargetHeader({
  roomNumber,
  label,
  subtitle,
  roundNo,
}: {
  roomNumber: string | null;
  label: string;
  subtitle: string | null;
  roundNo: number;
}) {
  return (
    <div className="flex items-center gap-4 rounded-[20px] bg-brand p-4 text-white" data-testid="target-header">
      <span className="flex size-[60px] shrink-0 items-center justify-center rounded-xl bg-white/15 text-[22px] font-bold">
        {roomNumber ?? '–'}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[20px] leading-tight font-bold">{label}</span>
        <span className="block text-[14px] text-white/85">
          {[subtitle, `รอบที่ ${roundNo}`].filter(Boolean).join(' · ')}
        </span>
      </span>
    </div>
  );
}
