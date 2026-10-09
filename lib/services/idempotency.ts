// Makes a money-moving request safe to repeat.
//
// The caller sends a key with the request. The first time, the work is done and its result is
// stored under the key in the same transaction. Any later request with the same key gets that
// stored result back and nothing is done again. Call this only after taking the row lock for
// whatever is being changed (the membership, the payment): the lock is what makes two simultaneous
// requests with the same key run one after the other, so the second finds the first one's result.

import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api'
import type { Db } from './core'

export const requestHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
const fullKey = (ownerId: string, scope: string, key: string) => `${ownerId}:${scope}:${key}`

/** The stored result for a key, if the request has already been carried out. */
export async function previousResult<T>(db: Db, ownerId: string, scope: string, key: string | null | undefined, hash: string): Promise<T | null> {
  if (!key) return null
  const row = await db.idempotencyKey.findUnique({ where: { key: fullKey(ownerId, scope, key) } })
  if (!row) return null
  // The same key with different contents is a mistake by the caller, not a retry.
  if (row.requestHash !== hash) throw new ApiError(409, 'This request key was already used for a different request.', 'idempotency_key_reused')
  if (row.response === null) throw new ApiError(409, 'This request is already being processed. Try again in a moment.', 'request_in_progress')
  return row.response as T
}

export async function withIdempotency<T extends object>(
  db: Db,
  input: { ownerId: string; scope: string; key?: string | null; hash: string },
  run: () => Promise<T>
): Promise<{ result: T; replayed: boolean }> {
  if (!input.key) return { result: await run(), replayed: false }
  const key = fullKey(input.ownerId, input.scope, input.key)
  const earlier = await previousResult<T>(db, input.ownerId, input.scope, input.key, input.hash)
  if (earlier !== null) return { result: earlier, replayed: true }
  const claimed = await db.idempotencyKey.createMany({ data: [{ key, ownerId: input.ownerId, scope: input.scope, requestHash: input.hash }], skipDuplicates: true })
  if (claimed.count === 0) {
    // Someone holding a different lock used the same key at the same moment and has since committed.
    const other = await previousResult<T>(db, input.ownerId, input.scope, input.key, input.hash)
    if (other !== null) return { result: other, replayed: true }
    throw new ApiError(409, 'This request is already being processed. Try again in a moment.', 'request_in_progress')
  }
  const result = await run()
  // Results are plain data (ids, amounts, dates as text), stored as they were returned.
  await db.idempotencyKey.update({ where: { key }, data: { response: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } })
  return { result, replayed: false }
}
