'use client';

import { useRouter } from 'next/navigation';

/** 08-ux-ui §6.5 picker: one select, classes grouped by grade, then the buildings or zones. */
export function ChartPicker({
  classes,
  areas,
  areaWord,
  selected,
}: {
  classes: { classId: string; display: string; roomNumber: string | null; grade: string }[];
  areas: { areaId: string; name: string }[];
  areaWord: string;
  selected: string | null;
}) {
  const router = useRouter();
  const grades = [...new Set(classes.map((c) => c.grade))];
  const known =
    selected !== null &&
    (classes.some((c) => `class:${c.classId}` === selected) || areas.some((a) => `area:${a.areaId}` === selected));
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor="chart-target" className="text-[13px] font-semibold">
        เลือกห้องเรียนหรือ{areaWord}
      </label>
      <select
        id="chart-target"
        value={known ? selected! : ''}
        onChange={(e) => {
          const [type, id] = e.target.value.split(':');
          if (type && id) router.push(`/charts?type=${type}&id=${id}`);
        }}
        className="h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-[16px]"
      >
        <option value="" disabled>
          — เลือก —
        </option>
        {grades.map((g) => (
          <optgroup key={g} label={g}>
            {classes
              .filter((c) => c.grade === g)
              .map((c) => (
                <option key={c.classId} value={`class:${c.classId}`}>
                  {c.roomNumber ? `${c.roomNumber} · ` : ''}
                  {c.display}
                </option>
              ))}
          </optgroup>
        ))}
        {areas.length ? (
          <optgroup label={areaWord}>
            {areas.map((a) => (
              <option key={a.areaId} value={`area:${a.areaId}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </div>
  );
}
