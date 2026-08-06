/**
 * Thin centered separator introducing a resource group in the mission panel's
 * File Changes section.
 */
export function FileChangeResourceGroupHeader({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-3 py-1"
      role="presentation"
      aria-label={`${label} file changes`}
    >
      <div className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="shrink-0 text-[11px] font-medium tracking-wide text-[var(--color-ink-dim)]">
        {label}
      </span>
      <div className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}
