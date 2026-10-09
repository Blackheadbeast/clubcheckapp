// Two kinds of signed token used only by the public booking pages.
//
// A booking session says "this browser is this member, for booking at this gym". It is given after
// signing in on the booking page, or to a guest who has just given their details, and is accepted
// only by the public booking endpoints: it is not a member-app session and opens nothing else.
//
// A manage token names one booking or appointment. It is what the "manage your booking" link in a
// confirmation email carries, so someone with no account can still look at and cancel that one thing.

import { createHmac } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'

function secret() {
  const base = process.env.JWT_SECRET
  if (!base) throw new Error('JWT_SECRET is not set')
  return createHmac('sha256', base).update('clubcheck:public-booking:v1').digest()
}

export interface BookingSession {
  ownerId: string
  memberId: string
  /** The account's session version when it was issued; null for a guest. A password change ends it. */
  sessionVersion: number | null
}
export const SESSION_HOURS = 12
export const GUEST_SESSION_HOURS = 2

export async function signBookingSession(session: BookingSession) {
  const hours = session.sessionVersion === null ? GUEST_SESSION_HOURS : SESSION_HOURS
  return new SignJWT({ mid: session.memberId, gid: session.ownerId, sv: session.sessionVersion, typ: 'booking' })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('clubcheck-booking').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + hours * 3600).sign(secret())
}

export async function readBookingSession(token: string | null | undefined): Promise<BookingSession | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: 'clubcheck-booking' })
    if (payload.typ !== 'booking' || typeof payload.mid !== 'string' || typeof payload.gid !== 'string' || !(payload.sv === null || typeof payload.sv === 'number')) return null
    return { memberId: payload.mid, ownerId: payload.gid, sessionVersion: payload.sv as number | null }
  } catch {
    return null
  }
}

export interface ManageRef { ownerId: string; memberId: string; kind: 'class' | 'appointment'; id: string }

/** Good until a day after the thing it names is over. */
export async function signManageToken(ref: ManageRef, endsAt: Date) {
  return new SignJWT({ gid: ref.ownerId, mid: ref.memberId, k: ref.kind, rid: ref.id, typ: 'manage' })
    .setProtectedHeader({ alg: 'HS256' }).setAudience('clubcheck-booking').setIssuedAt().setExpirationTime(Math.floor(Math.max(endsAt.getTime(), Date.now()) / 1000) + 86_400).sign(secret())
}

export async function readManageToken(token: string | null | undefined): Promise<ManageRef | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: 'clubcheck-booking' })
    if (payload.typ !== 'manage' || typeof payload.mid !== 'string' || typeof payload.gid !== 'string' || typeof payload.rid !== 'string' || !['class', 'appointment'].includes(payload.k as string)) return null
    return { ownerId: payload.gid, memberId: payload.mid, kind: payload.k as 'class' | 'appointment', id: payload.rid }
  } catch {
    return null
  }
}
