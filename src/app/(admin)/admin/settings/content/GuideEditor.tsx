'use client';

import { useActionState } from 'react';
import { ActionMessage, inputCls, primaryCls, type MessageState } from '@/components/app/settings';
import { saveGuideAction } from './actions';

export interface GuideDraft {
  id?: string;
  slug: string;
  title: string;
  bodyMd: string;
  audience: string;
  sortOrder: number;
}

/** Guide page editor: slug, title, audience, order and the Markdown body (headings, lists, **bold**, links). */
export function GuideEditor({ page }: { page: GuideDraft }) {
  const [state, action, pending] = useActionState<MessageState | null, FormData>(saveGuideAction, null);
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="แก้ไขหน้าคู่มือ">
      {page.id ? <input type="hidden" name="id" value={page.id} /> : null}
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_100px]">
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ชื่อหน้า
          <input name="title" defaultValue={page.title} required className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ชื่อในลิงก์ (a-z 0-9 -)
          <input name="slug" defaultValue={page.slug} required className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ผู้อ่าน
          <select name="audience" defaultValue={page.audience} className={inputCls}>
            <option value="public">ทุกคน (หน้าสาธารณะ)</option>
            <option value="committee">กรรมการ</option>
            <option value="admin">ผู้ดูแล</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold">
          ลำดับ
          <input name="sortOrder" type="number" min={0} max={999} defaultValue={page.sortOrder} className={inputCls} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        เนื้อหา (Markdown: # หัวข้อ, - รายการ, **ตัวหนา**, [ลิงก์](/rankings))
        <textarea
          name="bodyMd"
          defaultValue={page.bodyMd}
          rows={12}
          className="rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-[14px] font-normal"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryCls}>
          บันทึก
        </button>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}
