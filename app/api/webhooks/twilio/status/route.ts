import { NextRequest, NextResponse } from 'next/server'
import { formParams, fromTwilio, twiml } from '@/lib/twilio-http'
import { applySmsStatus } from '@/lib/services/sms'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Delivery reports for texts we sent (sent, delivered, undelivered, failed). Each outgoing
// message names this address as its status callback, so nothing needs configuring in Twilio.
// Reports arrive more than once and out of order; a final state is never undone.
export async function POST(request: NextRequest) {
  if (!process.env.TWILIO_AUTH_TOKEN) return NextResponse.json({ error: 'SMS is not configured' }, { status: 503 })
  const params = await formParams(request)
  if (!fromTwilio(request, params)) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  if (!params.MessageSid || !params.MessageStatus) return NextResponse.json({ error: 'Not a status report' }, { status: 400 })
  try {
    await applySmsStatus({ sid: params.MessageSid, status: params.MessageStatus, errorCode: params.ErrorCode || null, errorMessage: params.ErrorMessage || null })
  } catch (error) {
    console.error('[twilio] status failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not record the status' }, { status: 500 })
  }
  return twiml()
}
