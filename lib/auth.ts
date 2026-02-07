import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

// Role permissions
export const ROLE_PERMISSIONS = {
  owner: ['all'],
  manager: ['members', 'prospects', 'checkin', 'kiosk', 'analytics', 'broadcast', 'invoices'],
  front_desk: ['members.view', 'checkin', 'kiosk'],
} as const;

export type StaffRole = 'owner' | 'manager' | 'front_desk';

export interface AuthPayload {
  ownerId: string;
  staffId?: string;
  role?: StaffRole;
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

export async function getOwnerFromCookie(): Promise<AuthPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function hasPermission(role: StaffRole | undefined, permission: string): boolean {
  if (!role) return true; // Owner login (no role = full access)
  const perms = ROLE_PERMISSIONS[role] as readonly string[];
  if (perms.includes('all')) return true;
  if (perms.includes(permission)) return true;
  // Check for partial permissions (e.g., 'members.view' matches 'members')
  if (perms.some((p: string) => permission.startsWith(p.split('.')[0]))) return true;
  return false;
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
  permission: string
): { allowed: true } | { allowed: false; error: string; status: number } {
  if (!auth) {
    return { allowed: false, error: 'Unauthorized', status: 401 };
  }

  if (!hasPermission(auth.role, permission)) {
    return { allowed: false, error: 'Access denied', status: 403 };
  }

  return { allowed: true };
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