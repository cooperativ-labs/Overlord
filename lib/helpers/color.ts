const hexColorPattern = /^#([0-9a-fA-F]{6})$/;

export function normalizeHexColor(value: string): string {
  const trimmed = value.trim();
  if (!hexColorPattern.test(trimmed)) {
    throw new Error('Color must be a valid hex value like #d4d4d8.');
  }
  return trimmed.toLowerCase();
}
