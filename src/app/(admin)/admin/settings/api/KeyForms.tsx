'use client';

import { useState, useTransition } from 'react';
import { buttonCls, inputCls, primaryCls } from '@/components/app/settings';
import { createKeyAction, revokeKeyAction } from './actions';

/** New key: the plain value is shown once here and never again (only its hash is stored). */
export function CreateKeyForm() {
  const [name, setName] = useState('ปพ.5 program');
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createKeyAction(name);
            if (r.ok) {
              setKey(r.data.key);
              setError(null);
            } else setError(r.error.message);
          });
        }}
      >
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ชื่อคีย์
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </label>
        <button type="submit" disabled={pending} className={primaryCls}>
          สร้างคีย์ใหม่
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-[14px] text-danger-ink">
          {error}
        </p>
      ) : null}
      {key ? (
        <div role="status" className="rounded-md bg-warn-soft px-4 py-3 text-[14px] text-warn-ink">
          คัดลอกคีย์นี้ไปใส่ในโปรแกรม ปพ.5 ตอนนี้ ระบบจะไม่แสดงอีก
          <code
            data-testid="new-key"
            className="mt-2 block rounded bg-surface px-2 py-1 font-mono text-[13px] break-all text-ink"
          >
            {key}
          </code>
        </div>
      ) : null}
    </div>
  );
}

export function RevokeButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`ยกเลิกคีย์ ${name}`}
      onClick={() => {
        if (window.confirm(`ยกเลิกคีย์ "${name}"? โปรแกรมที่ใช้คีย์นี้จะเรียกข้อมูลไม่ได้อีก`))
          start(async () => void (await revokeKeyAction(id)));
      }}
      className={buttonCls}
    >
      ยกเลิก
    </button>
  );
}
