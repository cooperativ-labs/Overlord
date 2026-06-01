import { cn } from '@/lib/utils';

type ProjectColorDotProps = {
  color: string | null | undefined;
  /** Sizing/extra classes. Defaults to the prevailing `h-2 w-2` swatch size. */
  className?: string;
  /** When set, also tints the border with the project color (pair with a `border` class). */
  withBorder?: boolean;
  /** Optional native tooltip (e.g. the project name). */
  title?: string;
};

/**
 * The small project-color swatch dot rendered next to project names across the
 * app. Centralizes the `rounded-full` + inline `backgroundColor` pattern.
 */
export function ProjectColorDot({ color, className, withBorder, title }: ProjectColorDotProps) {
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', className)}
      title={title}
      style={{
        backgroundColor: color ?? undefined,
        ...(withBorder ? { borderColor: color ?? undefined } : {})
      }}
    />
  );
}
