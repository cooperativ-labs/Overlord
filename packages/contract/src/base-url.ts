/**
 * Strip trailing slashes so backend URLs compare and concatenate consistently.
 * Shared by the CLI and the desktop shell, which both key stored credentials by
 * backend URL.
 */
export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
