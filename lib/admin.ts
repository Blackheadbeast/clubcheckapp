export const ADMIN_EMAILS = ['blueloomventuresllc@gmail.com'];

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/**
 * The signed-in platform administrator, or the reason there is none.
 *
 * Being the administrator takes three things, not one: the session is the account holder's own
 * (staff of that account are not administrators), the account's address is on the list, and that
 * address has been verified. Without the last, anyone could register the administrator's address
 * before they did and be let in; without the first, every coach on the administrator's own gym
 * account would be one.
 */
export async function platformAdmin(): Promise<{ ok: true; ownerId: string } | { ok: false; status: 401 | 403 }> {
  const { getOwnerFromCookie } = await import('./auth');
  const { prisma } = await import('./prisma');
  const auth = await getOwnerFromCookie();
  if (!auth?.ownerId) return { ok: false, status: 401 };
  if (auth.staffId || auth.salesRepId) return { ok: false, status: 403 };
  const owner = await prisma.owner.findUnique({ where: { id: auth.ownerId }, select: { email: true, emailVerified: true } });
  if (!owner || !owner.emailVerified || !isAdminEmail(owner.email)) return { ok: false, status: 403 };
  return { ok: true, ownerId: auth.ownerId };
}
