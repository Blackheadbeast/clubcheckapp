export const ADMIN_EMAILS = ['blueloomventuresllc@gmail.com'];

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
