import { createHash } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { can, isRole, type Permission } from "./permissions";
import { REQUIREMENT_HEADER } from "./route-permissions";

export type StaffRole =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'front_desk'
  | 'coach'
  | 'trainer'
  | 'sales'
  | 'accountant'
  | 'sales_rep';

export interface AuthPayload {
  ownerId: string;
  staffId?: string;
  role?: StaffRole;
  emailVerified?: boolean;
  salesRepId?: string;
  /** A fingerprint of the password in force when the session began. Changing the password ends every earlier session. */
  pv?: string;
}

/** Not the password and not reversible to its hash: just enough to notice that the password has since changed. */
export function passwordVersion(passwordHash: string): string {
  return createHash("sha256").update(`clubcheck:password-version:${passwordHash}`).digest("hex").slice(0, 16);
}

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export async function createToken(payload: AuthPayload) {
  const secret = getSecret();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as AuthPayload;
  } catch {
    return null;
  }
}

/**
 * The signed-in session, or null. For staff sessions this re-reads the staff
 * record, so a deactivated account or a changed role takes effect at once
 * rather than when the 7-day token expires. On legacy API routes it also
 * enforces the permission the middleware attached to the request.
 */
export async function getOwnerFromCookie(): Promise<AuthPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload?.ownerId) return null;

  let role: StaffRole = 'owner';
  const { prisma } = await import("./prisma");
  if (!payload.staffId) {
    // A token must not outlive the account it was issued for.
    const owner = await prisma.owner.findUnique({ where: { id: payload.ownerId }, select: { id: true, password: true } });
    if (!owner) return null;
    // A session from before the password was changed is over.
    if (payload.pv && payload.pv !== passwordVersion(owner.password)) return null;
  } else {
    const staff = await prisma.staff.findFirst({
      where: { id: payload.staffId, ownerId: payload.ownerId },
      select: { role: true, active: true, password: true },
    });
    if (!staff || !staff.active || !isRole(staff.role) || staff.role === 'owner') return null;
    if (payload.pv && payload.pv !== passwordVersion(staff.password)) return null;
    role = staff.role;
    payload.role = role;
  }

  const required = (await headers()).get(REQUIREMENT_HEADER);
  if (required && required !== 'any') {
    if (required === 'owner') {
      if (payload.staffId) return null;
    } else if (!can(role, required as Permission)) {
      return null;
    }
  }
  return payload;
}

/**
 * Token-only permission check. The role in the token can be up to 7 days stale,
 * so API routes use lib/api.ts, which re-reads the staff record on every request.
 */
export function hasPermission(role: StaffRole | undefined, permission: Permission): boolean {
  return can(role ?? 'owner', permission);
}

export function isOwnerRole(auth: AuthPayload | null): boolean {
  return auth !== null && !auth.staffId;
}

/**
 * Check if the authenticated user has a specific permission.
 * Returns { allowed: true } or { allowed: false, error, status }
 */
export function requirePermission(
  auth: AuthPayload | null,
  permission: Permission
): { allowed: true } | { allowed: false; error: string; status: number } {
  if (!auth) {
    return { allowed: false, error: 'Unauthorized', status: 401 };
  }

  if (auth.salesRepId || !hasPermission(auth.staffId ? auth.role : 'owner', permission)) {
    return { allowed: false, error: 'Access denied', status: 403 };
  }

  return { allowed: true };
}

export async function getSalesRepFromCookie(): Promise<AuthPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("sales-auth-token")?.value;
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload?.salesRepId) return null;
  return payload;
}

/** Extract owner from a NextRequest object (for API route handlers) */
export async function getOwnerFromRequest(
  request: NextRequest
): Promise<{ ownerId: string } | null> {
  const token = request.cookies.get("auth-token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** For server components / server actions — redirects to /login if not authenticated */
export async function requireOwner(): Promise<{ ownerId: string }> {
  const owner = await getOwnerFromCookie();
  if (!owner) {
    redirect("/login");
  }
  return owner;
}