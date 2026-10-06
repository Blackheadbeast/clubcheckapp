// Shared API route wrapper: authentication, server-side role checks, tenant
// context, demo/billing write gates, body validation and a consistent
// response shape ({ data, meta? } on success, { error, code?, details? } on failure).

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getOwnerFromCookie, type AuthPayload } from '@/lib/auth'
import { can, type Permission, type Role, isRole } from '@/lib/permissions'
import { isDemoOwner, DEMO_READ_ONLY_MESSAGE } from '@/lib/demo'
import { requireWriteAccess } from '@/lib/billing'
import { createAuditLog } from '@/lib/audit'
import { checkRateLimit, getClientIP } from '@/lib/rate-limit'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown
  ) {
    super(message)
  }
}

export const notFound = (what = 'Record') => new ApiError(404, `${what} not found`, 'not_found')
export const badRequest = (message: string, code = 'bad_request') => new ApiError(400, message, code)
export const conflict = (message: string, code = 'conflict') => new ApiError(409, message, code)

export interface Actor {
  type: 'owner' | 'staff'
  id: string
  name: string
  email?: string
  role: Role
}

export interface AuditInput {
  entityType?: string
  entityId?: string
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}

export interface Ctx<B = undefined> {
  req: NextRequest
  ownerId: string
  auth: AuthPayload
  actor: Actor
  body: B
  query: URLSearchParams
  params: Record<string, string>
  can: (permission: Permission) => boolean
  audit: (action: string, description: string, input?: AuditInput) => Promise<void>
}

interface Options<S extends z.ZodTypeAny | undefined> {
  /** Required permission(s). An array means "any of". null = any signed-in user of the account. */
  permission: Permission | Permission[] | null
  /** Mutations: blocked for the demo account and when the subscription is read-only. */
  write?: boolean
  body?: S
  rateLimit?: { key: string; windowMs: number; maxRequests: number }
}

export class Paginated<T> {
  constructor(
    public items: T[],
    public total: number,
    public page: number,
    public pageSize: number,
    public extra?: Record<string, unknown>
  ) {}
}

export function paging(query: URLSearchParams, defaultSize = 25) {
  const page = Math.max(1, parseInt(query.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(query.get('pageSize') || String(defaultSize), 10) || defaultSize))
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function fail(status: number, error: string, code?: string, details?: unknown) {
  return NextResponse.json({ error, ...(code && { code }), ...(details !== undefined && { details }) }, { status })
}

async function resolveActor(auth: AuthPayload): Promise<Actor | null> {
  if (auth.salesRepId) return null
  if (!auth.staffId) {
    return { type: 'owner', id: auth.ownerId, name: 'Owner', role: 'owner' }
  }
  // getOwnerFromCookie has already confirmed the staff record is active and refreshed the role.
  const staff = await prisma.staff.findFirst({
    where: { id: auth.staffId, ownerId: auth.ownerId, active: true },
    select: { id: true, name: true, email: true },
  })
  if (!staff || !isRole(auth.role) || auth.role === 'owner') return null
  return { type: 'staff', id: staff.id, name: staff.name, email: staff.email, role: auth.role }
}

/** Resolve the signed-in actor for server components and legacy routes. */
export async function getActor(): Promise<{ auth: AuthPayload; actor: Actor } | null> {
  const auth = await getOwnerFromCookie()
  if (!auth?.ownerId) return null
  const actor = await resolveActor(auth)
  return actor ? { auth, actor } : null
}

type RouteContext = { params?: Record<string, string> | Promise<Record<string, string>> }

export function handler<S extends z.ZodTypeAny | undefined = undefined>(
  opts: Options<S>,
  fn: (ctx: Ctx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<unknown>
) {
  return async (req: NextRequest, routeCtx: RouteContext = {}) => {
    try {
      const session = await getActor()
      if (!session) return fail(401, 'Unauthorized', 'unauthorized')
      const { auth, actor } = session

      const required = opts.permission === null ? [] : [opts.permission].flat()
      if (required.length > 0 && !required.some((p) => can(actor.role, p))) {
        return fail(403, 'You do not have permission to do that.', 'forbidden')
      }

      if (opts.rateLimit) {
        const result = checkRateLimit(`${opts.rateLimit.key}:${auth.ownerId}:${getClientIP(req)}`, opts.rateLimit)
        if (!result.allowed) {
          return NextResponse.json(
            { error: 'Too many requests. Please slow down.', code: 'rate_limited' },
            { status: 429, headers: { 'Retry-After': String(Math.ceil((result.resetAt - Date.now()) / 1000)) } }
          )
        }
      }

      if (opts.write) {
        if (isDemoOwner(auth.ownerId)) return fail(403, DEMO_READ_ONLY_MESSAGE, 'demo_read_only')
        const access = await requireWriteAccess(auth.ownerId)
        if (!access.allowed) return fail(access.status, access.error, 'billing_read_only')
      }

      let body: unknown = undefined
      if (opts.body) {
        let raw: unknown
        try {
          raw = await req.json()
        } catch {
          return fail(400, 'Request body must be valid JSON.', 'invalid_json')
        }
        const parsed = opts.body.safeParse(raw)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          const path = issue.path.join('.')
          return fail(400, path ? `${path}: ${issue.message}` : issue.message, 'validation_error', parsed.error.issues)
        }
        body = parsed.data
      }

      const ctx: Ctx<any> = {
        req,
        ownerId: auth.ownerId,
        auth,
        actor,
        body,
        query: req.nextUrl.searchParams,
        params: (await routeCtx.params) || {},
        can: (permission) => can(actor.role, permission),
        audit: (action, description, input = {}) =>
          createAuditLog({
            action,
            description,
            ownerId: auth.ownerId,
            actorType: actor.type,
            actorId: actor.id,
            actorEmail: actor.email,
            ipAddress: getClientIP(req),
            userAgent: req.headers.get('user-agent') || undefined,
            ...input,
          }),
      }

      const result = await fn(ctx)
      if (result instanceof NextResponse || result instanceof Response) return result
      if (result instanceof Paginated) {
        return NextResponse.json({
          data: result.items,
          meta: {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
            ...result.extra,
          },
        })
      }
      return NextResponse.json({ data: result ?? null })
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.message, error.code, error.details)
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return fail(404, 'Record not found', 'not_found')
        if (error.code === 'P2002') return fail(409, 'A record with those details already exists.', 'conflict')
        if (error.code === 'P2003') return fail(409, 'That record is still in use and cannot be removed.', 'in_use')
      }
      console.error(`[api] ${req.method} ${req.nextUrl.pathname} failed:`, error)
      return fail(500, 'Something went wrong on our side. Please try again.', 'internal_error')
    }
  }
}

type OwnedModel = 'member' | 'location' | 'staff' | 'membershipPlan' | 'classType' | 'tag' | 'product' | 'prospect'

/**
 * Foreign keys alone do not enforce tenancy: any id supplied by a client must be
 * checked against the caller's account before it is stored or followed.
 */
export async function assertOwned(ownerId: string, model: OwnedModel, id: string | null | undefined, label?: string) {
  if (!id) return
  const found = await (prisma[model] as any).findFirst({ where: { id, ownerId }, select: { id: true } })
  if (!found) throw notFound(label || model)
}

export async function assertAllOwned(ownerId: string, model: OwnedModel, ids: string[] | undefined, label?: string) {
  if (!ids || ids.length === 0) return
  const unique = Array.from(new Set(ids))
  const count = await (prisma[model] as any).count({ where: { id: { in: unique }, ownerId } })
  if (count !== unique.length) throw notFound(label || model)
}
