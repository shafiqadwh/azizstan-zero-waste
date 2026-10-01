'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { buttonCls, inputCls, primaryCls } from '@/components/app/settings';
import { deleteGuideAction, deleteOrderAction } from './actions';

/** Upload a PDF appointment order (POST /api/v1/orders). */
export function OrderUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setBusy(true);
        setMessage(null);
        const res = await fetch('/api/v1/orders', { method: 'POST', body: new FormData(form) });
        setBusy(false);
        if (res.ok) {
          form.reset();
          setMessage({ ok: true, text: 'อัปโหลดแล้ว' });
          router.refresh();
        } else {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          setMessage({ ok: false, text: body?.error?.message ?? 'อัปโหลดไม่สำเร็จ' });
        }
      }}
    >
      <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[13px] font-semibold">
        ชื่อเอกสาร
        <input name="title" required placeholder="คำสั่งที่ 23/2569" className={inputCls} />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        ไฟล์ PDF
        <input name="file" type="file" accept="application/pdf" required className="h-11 text-[14px]" />
      </label>
      <button type="submit" disabled={busy} className={primaryCls}>
        อัปโหลด
      </button>
      {message ? (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={`w-full text-[14px] ${message.ok ? 'text-brand-ink' : 'text-danger-ink'}`}
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}

export function DeleteButton({ id, kind }: { id: string; kind: 'order' | 'guide' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className={buttonCls}
      onClick={async () => {
        if (!window.confirm('ลบรายการนี้?')) return;
        setBusy(true);
        await (kind === 'order' ? deleteOrderAction(id) : deleteGuideAction(id));
        setBusy(false);
        router.refresh();
      }}
    >
      ลบ
    </button>
  );
}
