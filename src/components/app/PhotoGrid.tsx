'use client';

import { Camera, Loader2, X } from 'lucide-react';
import { useRef } from 'react';

export interface PhotoItem {
  key: string;
  /** object URL while uploading, then the server thumbnail */
  src: string;
  status: 'uploading' | 'done' | 'error';
  evidenceId?: string;
  error?: string;
}

/**
 * 08-ux-ui §4.7: 3 columns, remove button on each photo, dashed add tile. `accept="image/*"` without `capture`:
 * the phone offers the camera or the gallery (BR-V3, Q7).
 */
export function PhotoGrid({
  inputId,
  items,
  max,
  addLabel,
  onAdd,
  onRemove,
  describedBy,
}: {
  inputId: string;
  items: PhotoItem[];
  max: number;
  addLabel: string;
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
  describedBy?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const room = max - items.length;
  return (
    <ul className="grid grid-cols-3 gap-2">
      {items.map((p, i) => (
        <li key={p.key} className="relative aspect-square overflow-hidden rounded-[14px] bg-surface-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: and permission-checked API URLs */}
          <img src={p.src} alt={`รูปที่ ${i + 1}`} className="size-full object-cover" />
          {p.status === 'uploading' ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white" role="status">
              <Loader2 className="animate-spin" size={28} aria-label="กำลังอัปโหลด" />
            </span>
          ) : null}
          {p.status === 'error' ? (
            <span className="absolute inset-x-0 top-0 bg-danger px-1 py-0.5 text-[12px] text-white">{p.error}</span>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(p.key)}
            aria-label={`ลบรูปที่ ${i + 1}`}
            className="absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full bg-black/70 text-white"
          >
            <X size={16} aria-hidden />
          </button>
        </li>
      ))}
      {room > 0 ? (
        <li className="aspect-square">
          <label
            htmlFor={inputId}
            className="flex size-full cursor-pointer flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed border-brand bg-brand-soft/60 text-center text-[13px] font-semibold text-brand-ink"
          >
            <Camera size={26} aria-hidden />
            {addLabel}
          </label>
          <input
            ref={ref}
            id={inputId}
            type="file"
            accept="image/*"
            multiple={room > 1}
            aria-describedby={describedBy}
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].slice(0, room);
              if (files.length) onAdd(files);
              if (ref.current) ref.current.value = '';
            }}
          />
        </li>
      ) : null}
    </ul>
  );
}
