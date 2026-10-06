import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Delivery tracking from Resend (delivered / opened / clicked / bounced).
// Point a Resend webhook at /api/webhooks/resend and set RESEND_WEBHOOK_SECRET
// to its signing secret. Requests without a valid signature are rejected.

const RANK: Record<string, number> = { queued: 0, sending: 0, sent: 1, delivered: 2, opened: 3, clicked: 4 }

function verify(secret: string, id: string, timestamp: string, body: string, header: string) {
  // Svix scheme: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_".
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  return header.split(' ').some((part) => {
    const signature = Buffer.from(part.split(',')[1] || '', 'base64')
    return signature.length === expected.length && timingSafeEqual(signature, expected)
  })
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 })
  const body = await request.text()
  const id = request.headers.get('svix-id') || ''
  const timestamp = request.headers.get('svix-timestamp') || ''
  const signature = request.headers.get('svix-signature') || ''
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) < 5 * 60
  if (!id || !fresh || !verify(secret, id, timestamp, body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: { type?: string; data?: { email_id?: string; bounce?: { message?: string } } }
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const providerId = event.data?.email_id
  if (!providerId || !event.type) return NextResponse.json({ ok: true })
  const message = await prisma.message.findFirst({ where: { providerId } })
  if (!message) return NextResponse.json({ ok: true })

  const now = new Date()
  const type = event.type.replace('email.', '')
  if (type === 'bounced' || type === 'complained') {
    await prisma.message.update({ where: { id: message.id }, data: { status: 'failed', error: type === 'bounced' ? event.data?.bounce?.message || 'Bounced' : 'Marked as spam' } })
    // Stop marketing to an address that bounced hard or complained.
    if (message.memberId) await prisma.member.update({ where: { id: message.memberId }, data: { emailOptIn: false } })
  } else if (RANK[type] !== undefined && RANK[type] > (RANK[message.status] ?? 0)) {
    // Events can arrive out of order: only ever move forwards.
    await prisma.message.update({
      where: { id: message.id },
      data: {
        status: type,
        ...(type === 'delivered' && { deliveredAt: now }),
        ...(type === 'opened' && { openedAt: message.openedAt || now }),
        ...(type === 'clicked' && { clickedAt: now, openedAt: message.openedAt || now }),
      },
    })
  }
  return NextResponse.json({ ok: true })
}
