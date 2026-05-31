const hexColorPattern = /^#([0-9a-fA-F]{6})$/;

export function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  if (!hexColorPattern.test(trimmed)) {
    throw new Error('Color must be a valid hex value like #d4d4d8.');
  }
  return trimmed.toLowerCase();
}

export type Rgb = { r: number; g: number; b: number };

/**
 * Parse a 3- or 6-digit hex color (with or without a leading `#`) into its
 * RGB channels. Returns `null` for anything that isn't a well-formed hex color.
 *
 * This is the canonical implementation that previously lived inline (and
 * identically) in `CalendarView.tsx` and `TicketListCard.tsx`.
 */
export function parseHexColor(value: string): Rgb | null {
  const normalized = value.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;

  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    if (!r || !g || !b) return null;
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16)
    };
  }

  if (hex.length === 6) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }

  return null;
}

/** Relative luminance (0–1) using the sRGB coefficients. */
export function getRelativeLuminance({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Pick a readable foreground (near-black or white) for text/icons drawn on top
 * of the given color. Matches the threshold used across the ticket views.
 */
export function getReadableForeground(rgb: Rgb): '#111827' | '#ffffff' {
  return getRelativeLuminance(rgb) > 0.6 ? '#111827' : '#ffffff';
}

/** Build an `rgba(...)` string from RGB channels and an alpha (0–1). */
export function rgba({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
