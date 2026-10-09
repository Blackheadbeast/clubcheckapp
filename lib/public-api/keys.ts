// API keys. The key is random, shown to the person who made it exactly once, and stored only as a
// SHA-256 hash: a fast hash is right here because the key is 256 bits of randomness, not a password.

import { createHash, randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ApiError, notFound, type Actor } from '@/lib/api'
import { can } from '@/lib/permissions'
import { z } from 'zod'
import { SCOPES, SCOPE_KEYS, isScope, type Scope } from './scopes'

const PREFIX = 'cc_live_'
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')
/** Looks like one of ours. Anything else is refused without touching the database. */
export const looksLikeKey = (key: string) => /^cc_live_[0-9a-f]{8}_[A-Za-z0-9_-]{40,50}$/.test(key)

export const apiKeySchema = z.object({
  name: z.string().trim().min(1, 'Give the key a name').max(80),
  description: z.string().trim().max(300).nullish().transform((v) => v || null),
  scopes: z.array(z.string()).min(1, 'Choose at least one scope').max(SCOPE_KEYS.length)
    .refine((list) => list.every(isScope), 'Unknown scope').transform((list) => Array.from(new Set(list)) as Scope[]),
  /** Days until the key stops working. Omitted: it works until revoked. */
  expiresInDays: z.number().int().min(1).max(730).nullish(),
})

/** What staff see about a key. Never the key or its hash. */
export const keyView = (k: { id: string; name: string; description: string | null; prefix: string; scopes: string[]; rateLimit: number | null; createdByName: string | null; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; revokedByName: string | null }, now = new Date()) => ({
  id: k.id, name: k.name, description: k.description, prefix: k.prefix, scopes: k.scopes, createdByName: k.createdByName, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, revokedAt: k.revokedAt, revokedByName: k.revokedByName,
  status: k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt <= now ? 'expired' : 'active',
})

export async function createApiKey(ownerId: string, input: z.infer<typeof apiKeySchema>, actor: Actor) {
  // A key cannot do more than the person making it.
  const beyond = input.scopes.filter((s) => !can(actor.role, SCOPES[s].permission))
  if (beyond.length) throw new ApiError(403, `Your role does not allow: ${beyond.join(', ')}.`, 'scope_not_allowed')
  const id = randomBytes(4).toString('hex')
  const key = `${PREFIX}${id}_${randomBytes(32).toString('base64url')}`
  const row = await prisma.apiKey.create({
    data: { ownerId, name: input.name, description: input.description, prefix: `${PREFIX}${id}`, keyHash: hashKey(key), scopes: input.scopes, createdById: actor.id, createdByName: actor.name, expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null },
  })
  // The only time the key itself leaves the server.
  return { ...keyView(row), key }
}

export async function listApiKeys(ownerId: string) {
  const rows = await prisma.apiKey.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' }, take: 200 })
  return rows.map((r) => keyView(r))
}

export async function revokeApiKey(ownerId: string, id: string, actor: Actor) {
  const row = await prisma.apiKey.findFirst({ where: { id, ownerId } })
  if (!row) throw notFound('API key')
  if (row.revokedAt) return keyView(row)
  return keyView(await prisma.apiKey.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedByName: actor.name } }))
}
