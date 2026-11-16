/**
 * The overview card's tab tones (mission-panel-redesign plan §6.2), defined once in light and
 * dark beside the feed's `KindBadge` tones. Each tab is a pill: unselected is a tinted background
 * with a matching border and dark text in its colour; selected is filled with the strong shade
 * and light text, so selection reads by fill rather than by hue. Every text/background pairing
 * here is chosen to clear 4.5:1 in both themes (700-shade fills under white text; 300-shade fills
 * under 950-shade text in dark mode; 900/100 text on the faint tints).
 */
export type OverviewTabTone = 'ink' | 'sky' | 'red' | 'violet' | 'grey';

export const OVERVIEW_TAB_TONES: Record<OverviewTabTone, { idle: string; selected: string }> = {
  ink: {
    idle: 'border-neutral-300 bg-neutral-50 text-neutral-900 hover:bg-neutral-100 dark:border-neutral-600 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/10',
    selected:
      'border-neutral-800 bg-neutral-800 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
  },
  sky: {
    idle: 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-100 dark:hover:bg-sky-500/20',
    selected:
      'border-sky-700 bg-sky-700 text-white dark:border-sky-300 dark:bg-sky-300 dark:text-sky-950'
  },
  red: {
    idle: 'border-red-300 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-100 dark:hover:bg-red-500/20',
    selected:
      'border-red-700 bg-red-700 text-white dark:border-red-300 dark:bg-red-300 dark:text-red-950'
  },
  violet: {
    idle: 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-100 dark:hover:bg-violet-500/20',
    selected:
      'border-violet-700 bg-violet-700 text-white dark:border-violet-300 dark:bg-violet-300 dark:text-violet-950'
  },
  grey: {
    idle: 'border-(--color-border) bg-(--color-surface-2) text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10',
    selected:
      'border-neutral-600 bg-neutral-600 text-white dark:border-neutral-300 dark:bg-neutral-300 dark:text-neutral-900'
  }
};
