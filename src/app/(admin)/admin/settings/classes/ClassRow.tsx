'use client';

import { X } from 'lucide-react';
import { useActionState } from 'react';
import { classRowAction, type ActionState } from './actions';
import { ActionMessage, buttonClass, inputClass } from './ui';

export interface ClassRowData {
  id: string;
  displayName: string;
  aliases: { id: string; alias: string }[];
  isActive: boolean;
}

/** Aliases are stored as lookup keys ("ม.1|amanah"); show them as readable text. */
const aliasLabel = (key: string) => key.replace('|', ' ');

export function ClassRow({ cls, canManage }: { cls: ClassRowData; canManage: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(classRowAction, null);
  return (
    <li
      data-testid={`class-${cls.displayName}`}
      className="flex flex-col gap-2 border-b border-line py-3 last:border-0"
    >
      <p className="font-semibold">
        {cls.displayName}
        {!cls.isActive ? <span className="ml-2 text-[12px] text-ink-muted">(ปิดใช้งาน)</span> : null}
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label={`ชื่อเรียกอื่นของ ${cls.displayName}`}>
        {cls.aliases.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-1 rounded-full bg-surface-muted py-0.5 pr-1 pl-2.5 text-[12px]"
          >
            {aliasLabel(a.alias)}
            {canManage ? (
              <form action={action}>
                <input type="hidden" name="intent" value="alias-remove" />
                <input type="hidden" name="aliasId" value={a.id} />
                <button
                  type="submit"
                  aria-label={`ลบชื่อเรียก ${aliasLabel(a.alias)}`}
                  className="flex size-6 items-center justify-center rounded-full hover:bg-line"
                >
                  <X size={14} aria-hidden />
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {canManage ? (
        <details className="group">
          <summary className="flex min-h-11 w-fit cursor-pointer items-center text-[14px] font-medium text-brand-ink underline">
            เพิ่มชื่อเรียกอื่น
          </summary>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <form action={action} className="flex min-w-0 items-end gap-2">
              <input type="hidden" name="intent" value="alias-add" />
              <input type="hidden" name="classId" value={cls.id} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor={`alias-${cls.id}`} className="text-[12px] text-ink-muted">
                  ชื่อในข้อมูลนักเรียน (ชื่อเรียกอื่น)
                </label>
                <input id={`alias-${cls.id}`} name="alias" placeholder="เช่น ม.1/1 Amanah" className={inputClass} />
              </div>
              <button type="submit" disabled={pending} className={buttonClass}>
                เพิ่ม
              </button>
            </form>
          </div>
        </details>
      ) : null}
      <ActionMessage state={state} />
    </li>
  );
}
