'use client';

/** 08-ux-ui §7 Error: plain message and a retry, never a stack trace. */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <div role="alert" className="rounded-xl border border-line bg-surface p-6">
        <h1 className="text-[20px] font-bold">เกิดข้อผิดพลาด</h1>
        <p className="mt-2 text-ink-muted">โหลดหน้านี้ไม่สำเร็จ อาจเป็นเพราะการเชื่อมต่อขัดข้องชั่วคราว</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 h-11 rounded-md bg-brand px-4 font-semibold text-white hover:bg-brand-ink"
        >
          ลองอีกครั้ง
        </button>
      </div>
    </main>
  );
}
