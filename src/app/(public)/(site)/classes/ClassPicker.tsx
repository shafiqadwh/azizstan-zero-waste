'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PublicClass } from '@/server/services/public.service';

const selectCls = 'h-11 w-full rounded-md border border-line-strong bg-surface px-2 text-[16px]';

/** §6.3: ชั้น and ห้อง side by side; picking a room opens its scores (`/classes?class=`). */
export function ClassPicker({ classes, selected }: { classes: PublicClass[]; selected: string | null }) {
  const router = useRouter();
  const current = classes.find((c) => c.classId === selected);
  const [grade, setGrade] = useState(current?.grade ?? '');
  const grades = [...new Set(classes.map((c) => c.grade))];
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        ชั้น
        <select value={grade} onChange={(e) => setGrade(e.target.value)} className={selectCls}>
          <option value="">เลือกชั้น</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        ห้อง
        <select
          value={current && current.grade === grade ? current.classId : ''}
          disabled={!grade}
          onChange={(e) => e.target.value && router.push(`/classes?class=${e.target.value}`)}
          className={selectCls}
        >
          <option value="">เลือกห้อง</option>
          {classes
            .filter((c) => c.grade === grade)
            .map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.roomNumber ? `${c.roomNumber} · ` : ''}
                {c.display}
              </option>
            ))}
        </select>
      </label>
    </div>
  );
}
