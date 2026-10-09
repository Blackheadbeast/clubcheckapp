import { NextRequest, NextResponse } from 'next/server'
import { formParams, fromTwilio, twiml } from '@/lib/twilio-http'
import { receiveInboundSms } from '@/lib/services/sms'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A text someone sent to one of our numbers. Set this as the "A message comes in" webhook on the
// Twilio number (or messaging service). Unsigned or wrongly signed requests are rejected.
//
// Storing the message is all this does. It never replies, and it never starts a campaign or an
// automation: Twilio itself answers STOP, START and HELP, and people answer everything else.
export async function POST(request: NextRequest) {
  if (!process.env.TWILIO_AUTH_TOKEN) return NextResponse.json({ error: 'SMS is not configured' }, { status: 503 })
  const params = await formParams(request)
  if (!fromTwilio(request, params)) return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  if (!params.MessageSid || !params.From || !params.To) return NextResponse.json({ error: 'Not a message' }, { status: 400 })
  try {
    await receiveInboundSms({ sid: params.MessageSid, from: params.From, to: params.To, body: params.Body || '' })
  } catch (error) {
    // A 500 makes Twilio try again; the message id makes a repeat harmless.
    console.error('[twilio] inbound failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not store the message' }, { status: 500 })
  }
  return twiml()
}
