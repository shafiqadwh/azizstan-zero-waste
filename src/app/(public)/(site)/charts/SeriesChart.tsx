'use client';

import { useEffect, useRef, useState } from 'react';
import type { SeriesPoint } from '@/server/services/public.service';

const H = 240;
const PAD = { top: 16, right: 12, bottom: 36, left: 40 };

/** The chart draws in CSS pixels (viewBox = its own width), so text stays 12–14 px on a phone and on a desktop. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round numbers for the y axis: 0 … yMax in about 4 steps of 1, 2, 2.5 or 5 × 10ⁿ. */
function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  // the full mark gets its own line; a label only when it does not crowd the tick below it
  if (out.at(-1)! < max) {
    if (max - out.at(-1)! < step / 2) out.pop();
    out.push(max);
  }
  return out;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * 08-ux-ui §6.5: one series, totals per round, y from 0 to the round maximum. Hover or tap a round for its value
 * (keyboard: Tab through the rounds); "ตาราง" shows the same numbers as a table.
 */
export function SeriesChart({ title, points, yMax }: { title: string; points: SeriesPoint[]; yMax: number }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [active, setActive] = useState<number | null>(null);
  const [box, W] = useWidth();
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const top = yMax > 0 ? yMax : 1;
  const band = points.length ? plotW / points.length : plotW;
  // each round sits in the middle of its own band, so the first and last points never touch the frame
  const x = (i: number) => PAD.left + band * (i + 0.5);
  const y = (v: number) => PAD.top + plotH - (plotH * v) / top;

  // line segments break at rounds without a result ("รอผล")
  const segments: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur.length) segments.push(cur.join(' '));
      cur = [];
    } else cur.push(`${cur.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(' '));
  const shown = active !== null ? points[active] : null;

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="มุมมอง" className="flex gap-2 self-end">
        {(['chart', 'table'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`h-10 rounded-md border px-3 text-[14px] font-medium ${
              view === v ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface'
            }`}
          >
            {v === 'chart' ? 'กราฟ' : 'ตาราง'}
          </button>
        ))}
      </div>

      {view === 'table' ? (
        <table className="w-full text-left text-[15px]" data-testid="series-table">
          <caption className="sr-only">คะแนนรวมแต่ละรอบ · {title}</caption>
          <thead className="text-[13px] text-ink-muted">
            <tr>
              <th className="py-2 font-medium">รอบ</th>
              <th className="py-2 font-medium">คะแนนรวม</th>
              <th className="py-2 font-medium">คะแนนเต็ม</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.roundNo} className="border-t border-line">
                <td className="py-2">รอบที่ {p.roundNo}</td>
                <td className="py-2 font-semibold">{p.label ?? 'รอผล'}</td>
                <td className="py-2 text-ink-muted">{p.max ? fmt(p.max) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative" data-testid="series-chart" ref={box}>
          {/* the readout sits above the plot, so it never covers a point */}
          <p role="status" className="mb-1 min-h-[24px] text-[14px]">
            {shown ? (
              <>
                <span className="text-ink-muted">รอบที่ {shown.roundNo} · </span>
                <span className="font-semibold">{shown.label ?? 'รอผล'}</span>
                {shown.max ? <span className="text-ink-muted"> จาก {fmt(shown.max)}</span> : null}
              </>
            ) : (
              <span className="text-ink-muted">แตะหรือชี้ที่รอบเพื่อดูคะแนน</span>
            )}
          </p>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="block w-full"
            role="img"
            aria-label={`กราฟคะแนนรวมแต่ละรอบของ ${title}`}
            onPointerLeave={() => setActive(null)}
          >
            {ticks(yMax).map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-ink-muted text-[13px]">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => (
              <text
                key={p.roundNo}
                x={x(i)}
                y={H - 12}
                textAnchor="middle"
                className={`text-[13px] ${active === i ? 'fill-ink font-semibold' : 'fill-ink-muted'}`}
              >
                รอบที่ {p.roundNo}
              </text>
            ))}
            {active !== null ? (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-line-strong"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null}
            {segments.map((d) => (
              <path key={d} d={d} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" />
            ))}
            {points.map((p, i) =>
              p.value === null ? (
                <text
                  key={`wait-${p.roundNo}`}
                  x={x(i)}
                  y={PAD.top + plotH - 8}
                  textAnchor="middle"
                  className="fill-ink-muted text-[12px]"
                >
                  รอผล
                </text>
              ) : null,
            )}
            {points.map((p, i) =>
              p.value === null ? null : (
                <circle
                  key={p.roundNo}
                  cx={x(i)}
                  cy={y(p.value)}
                  r={active === i ? 6 : 4.5}
                  className="fill-brand stroke-surface"
                  strokeWidth={2}
                />
              ),
            )}
            {/* hit targets: a full-height band per round, larger than the mark */}
            {points.map((p, i) => (
              <rect
                key={p.roundNo}
                x={x(i) - band / 2}
                y={PAD.top}
                width={band}
                height={plotH + PAD.bottom}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`รอบที่ ${p.roundNo}: ${p.label ?? 'รอผล'}${p.max ? ` จาก ${fmt(p.max)}` : ''}`}
                onPointerEnter={() => setActive(i)}
                onPointerDown={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-pointer outline-none"
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
