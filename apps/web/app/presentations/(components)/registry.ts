import type { SlideshowDefinition } from './types';

export interface SlideshowEntry {
  load: () => Promise<{ default: SlideshowDefinition }>;
  /** When true, the presentation is accessible without authentication. */
  public?: boolean;
}

export const SLIDESHOWS: Record<string, SlideshowEntry> = {
  'ai-builders-2026-05': {
    load: () => import('../shows/ai-builders-2026-05'),
    public: false
  }
};
