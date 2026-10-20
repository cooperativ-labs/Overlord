import { Loader2, type LucideIcon } from 'lucide-react';

import { cn } from '../lib/utils.ts';

/** Keep persistent status motion on compositor layers rather than repainting SVGs. */
export function StatusSpinner({
  icon: Icon = Loader2,
  className,
  slow = false
}: {
  icon?: LucideIcon;
  className?: string;
  slow?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-3.5 shrink-0 animate-spin will-change-transform motion-reduce:animate-none',
        slow && '[animation-duration:2.5s]',
        className
      )}
    >
      <Icon className="block size-full" />
    </span>
  );
}

/** The host must clip overflow. Translate a fixed gradient; never animate its background. */
export function ExecutingShimmer() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 animate-[shimmer_3s_linear_infinite] bg-linear-to-r from-transparent via-emerald-500/20 to-transparent will-change-transform motion-reduce:animate-none"
    />
  );
}
