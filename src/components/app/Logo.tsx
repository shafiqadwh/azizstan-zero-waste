import { cn } from '@/lib/utils';

/**
 * Text wordmark — the school has no logo file yet (Q9, 08-ux-ui §2).
 * Every screen uses this component so a real logo can be swapped in here only.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('font-bold tracking-tight text-brand', className)}>
      AZIZSTAN <span className="whitespace-nowrap">ZERO WASTE</span>
    </span>
  );
}
