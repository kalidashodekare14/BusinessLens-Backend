/**
 * Emails are stored and compared lowercase/trimmed (§6.4). The DTO normalizes
 * input for validation; services normalize again so no caller can bypass it.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
