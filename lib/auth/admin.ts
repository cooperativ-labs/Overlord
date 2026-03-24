export const ADMIN_EMAIL = 'jake@cooperativ.io';

export function isAdminEmail(email?: string | null): boolean {
  return email?.toLowerCase() === ADMIN_EMAIL;
}
