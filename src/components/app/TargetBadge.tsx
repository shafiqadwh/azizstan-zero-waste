/** 07-frontend §5: the only way a target is shown — `121 · ม.1 Amanah`, or the area name. */
export function TargetBadge({
  roomNumber,
  label,
  className,
}: {
  roomNumber: string | null;
  label: string;
  className?: string;
}) {
  return <span className={className}>{roomNumber ? `${roomNumber} · ${label}` : label}</span>;
}
