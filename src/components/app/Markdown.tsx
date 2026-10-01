import Link from 'next/link';
import { Fragment } from 'react';
import { parseMarkdown, type Inline } from '@/lib/markdown';

function Inlines({ items }: { items: Inline[] }) {
  return items.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'strong':
        return (
          <strong key={i}>
            <Inlines items={n.c} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <Inlines items={n.c} />
          </em>
        );
      case 'code':
        return (
          <code key={i} className="rounded bg-surface-muted px-1 text-[0.9em]">
            {n.v}
          </code>
        );
      case 'link':
        return n.href.startsWith('/') ? (
          <Link key={i} href={n.href} className="text-brand-ink underline">
            <Inlines items={n.c} />
          </Link>
        ) : (
          <a key={i} href={n.href} rel="noreferrer" target="_blank" className="text-brand-ink underline">
            <Inlines items={n.c} />
          </a>
        );
    }
  });
}

/** Guide page body: the safe Markdown subset of `@/lib/markdown`, rendered as elements (no raw HTML). */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 text-[16px] leading-[1.7]">
      {parseMarkdown(source).map((b, i) => {
        switch (b.t) {
          case 'h': {
            const cls = ['', 'text-[22px] font-bold', 'text-[19px] font-bold', 'text-[17px] font-semibold'][b.level];
            const H = (['h2', 'h2', 'h3', 'h4'] as const)[b.level];
            return (
              <H key={i} className={`mt-2 ${cls}`}>
                <Inlines items={b.c} />
              </H>
            );
          }
          case 'p':
            return (
              <p key={i}>
                <Inlines items={b.c} />
              </p>
            );
          case 'ul':
          case 'ol': {
            const L = b.t;
            return (
              <L key={i} className={`pl-6 ${b.t === 'ul' ? 'list-disc' : 'list-decimal'}`}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines items={it} />
                  </li>
                ))}
              </L>
            );
          }
          case 'hr':
            return <hr key={i} className="border-line" />;
        }
      })}
    </div>
  );
}
