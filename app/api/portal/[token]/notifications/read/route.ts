import { z } from 'zod'
import { portalHandler } from '@/lib/portal'
import { markRead } from '@/lib/services/member-notifications'

export const dynamic = 'force-dynamic'

// POST { ids?: string[] } - mark the given notifications read, or all of them when ids is omitted
export const POST = portalHandler({ write: true, body: z.object({ ids: z.array(z.string().uuid()).max(100).optional() }) }, async ({ member, body }) => markRead(member.id, body.ids))
