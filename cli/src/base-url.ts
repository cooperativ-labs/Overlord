/** Strip trailing slashes so backend URLs compare and concatenate consistently. */
export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
