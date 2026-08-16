import { Sparkles } from 'lucide-react';
import { useId } from 'react';

import { cn } from '@/lib/utils';

/**
 * Filled sparkle used by every provenance mark. Stroke-only muted icons were
 * too easy to miss; the blue-purple fill is the glanceable signal that an
 * agent (or automation) authored the row.
 */
export function OriginSparklesIcon({ className }: { className?: string }) {
  const gradientId = `origin-sparkle-${useId().replace(/:/g, '')}`;

  return (
    <Sparkles
      className={cn('h-3 w-3 shrink-0', className)}
      fill={`url(#${gradientId})`}
      stroke={`url(#${gradientId})`}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
    </Sparkles>
  );
}
