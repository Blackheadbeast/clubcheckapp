// Shared plumbing for the two Twilio webhooks.

import { NextRequest } from 'next/server'
import { validTwilioSignature, webhookBase } from '@/lib/messaging/sms'

/** Read a form-encoded webhook body as a plain object. */
export async function formParams(request: NextRequest) {
  const params: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(await request.text())) params[key] = value
  return params
}

/**
 * Is this really Twilio? The signature covers the exact public URL Twilio called, which behind a
 * proxy is not what the server sees, so it is checked against the configured address and against
 * the address the proxy says was requested.
 */
export function fromTwilio(request: NextRequest, params: Record<string, string>) {
  const path = request.nextUrl.pathname + request.nextUrl.search
  const urls = new Set<string>()
  const base = webhookBase()
  if (base) urls.add(base + path)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (host) urls.add(`${request.headers.get('x-forwarded-proto') || 'https'}://${host}${path}`)
  return validTwilioSignature(request.headers.get('x-twilio-signature'), [...urls], params)
}

/** Twilio expects TwiML back. An empty response means "do nothing further". */
export const twiml = () => new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
