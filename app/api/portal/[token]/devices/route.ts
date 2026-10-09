import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { portalHandler } from '@/lib/portal'

export const dynamic = 'force-dynamic'

const schema = z.object({ platform: z.enum(['ios', 'android', 'web']), pushToken: z.string().min(8).max(4096) })

// POST - register this device for push notifications (delivery arrives with the native app)
export const POST = portalHandler({ write: true, body: schema }, async ({ member, ownerId, body }) => {
  // A token identifies one device: if someone else signed in on it before, it now belongs to this member.
  await prisma.memberDevice.upsert({
    where: { pushToken: body.pushToken },
    create: { ownerId, memberId: member.id, platform: body.platform, pushToken: body.pushToken },
    update: { ownerId, memberId: member.id, platform: body.platform, lastSeenAt: new Date() },
  })
  return { registered: true }
})

// DELETE { pushToken } - stop sending to this device (sign-out)
export const DELETE = portalHandler({ write: true, body: z.object({ pushToken: z.string().min(8).max(4096) }) }, async ({ member, body }) => {
  await prisma.memberDevice.deleteMany({ where: { pushToken: body.pushToken, memberId: member.id } })
  return { registered: false }
})
