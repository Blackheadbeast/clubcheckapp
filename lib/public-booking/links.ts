// The emails that let someone we already know carry on with a booking: an invitation to set a
// password (the member app's own activation link), or a pointer back to the page to sign in.
// Both carry where they were, so they land back on the class or appointment they had chosen.

import { withinLimit } from '@/lib/login-attempts'
import { z } from 'zod'
import type { Member } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendAccountEmail } from '@/lib/member-auth-http'
import { queueMessage } from '@/lib/services/messaging'
import { flushOutbox } from '@/lib/services/automations'
import type { SiteCtx } from '@/lib/services/public-booking'

/** What the person had picked. Only ids and a time: nothing free-form ends up in a link. */
export const resumeSchema = z.object({
  classId: z.string().uuid().optional(),
  typeId: z.string().uuid().optional(),
  startsAt: z.string().datetime().optional(),
  staffId: z.string().uuid().optional(),
}).nullish()
export type Resume = z.infer<typeof resumeSchema>

export function resumePath(slug: string, resume: Resume) {
  const q = new URLSearchParams()
  if (resume?.classId) q.set('class', resume.classId)
  if (resume?.typeId) q.set('type', resume.typeId)
  if (resume?.typeId && resume.startsAt) q.set('at', resume.startsAt)
  if (resume?.typeId && resume.staffId) q.set('coach', resume.staffId)
  const query = q.toString()
  return `/book/${slug}${query ? `?${query}` : ''}`
}

export function continueLink(site: SiteCtx, origin: string, resume: Resume) {
  const path = resumePath(site.site.slug, resume)
  return async (member: Member, kind: 'invite' | 'sign_in', token: string | null) => {
    // A few of these to one address in a quarter of an hour is someone finishing a booking. More is someone filling an inbox.
    if (!(await withinLimit('booking-account', member.email, 3))) return
    if (kind === 'invite' && token) return sendAccountEmail(member, member.email, 'invite', token, origin, path)
    // They have an account: nothing secret to send, just the way back in.
    const url = `${origin}${path}${path.includes('?') ? '&' : '?'}signin=1`
    await prisma.$transaction((db) => queueMessage(db, {
      ownerId: site.ownerId, channel: 'email', memberId: member.id, transactional: true,
      subject: `Finish your booking at ${site.name}`,
      body: `Hi {{first_name}},\n\nSomeone (hopefully you) started a booking at ${site.name} with this email address. You already have an account with us, so sign in to finish:\n\n${url}\n\nForgotten your password? Choose "Forgot password" on the sign-in screen.\n\nIf this was not you, you can ignore this email.`,
      dedupeKey: `online:signin:${member.id}:${Math.floor(Date.now() / 600_000)}`,
    }))
    await flushOutbox(site.ownerId)
  }
}
