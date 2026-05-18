import type { SlideshowDefinition } from './types';

export const SLIDESHOWS: Record<string, () => Promise<{ default: SlideshowDefinition }>> = {
  'ai-builders-2026-05': () => import('../shows/ai-builders-2026-05')
};
