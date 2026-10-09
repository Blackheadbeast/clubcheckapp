// SMS provider boundary: sending, webhook signatures and phone numbers.
//
// Twilio is used through its REST API when TWILIO_ACCOUNT_SID and
// TWILIO_AUTH_TOKEN are set, with either a sending number (TWILIO_FROM_NUMBER,
// or a gym's own number) or TWILIO_MESSAGING_SERVICE_SID. Credentials are read
// here, on the server, and nowhere else: nothing about them reaches a browser.
// Without them every SMS is recorded as "skipped", so templates, consent rules,
// automations and history all behave the same before and after going live.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

export interface SmsSendInput {
  to: string
  /** The gym's sending number. Omitted when a messaging service picks the sender. */
  from: string | null
  body: string
  /** Where the provider reports sent / delivered / failed. */
  statusCallback?: string | null
}

export type SmsSendResult =
  | { ok: true; id: string }
  /** `retryable` separates "try again shortly" (rate limit, outage) from "this will never work" (bad number, opted out). */
  | { ok: false; error: string; code?: string; retryable: boolean }

export interface SmsProvider {
  name: string
  send(input: SmsSendInput): Promise<SmsSendResult>
}

/** Twilio error codes that mean the recipient has opted out at the carrier. */
export const OPTED_OUT_CODES = ['21610']
const RETRYABLE_CODES = ['20429', '30001', '30022', '30023', '14107']

function twilio(): SmsProvider | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID
  return {
    name: 'twilio',
    async send(input) {
      const params = new URLSearchParams({ To: input.to, Body: input.body })
      if (input.from) params.set('From', input.from)
      else if (service) params.set('MessagingServiceSid', service)
      else return { ok: false, error: 'No sending number is configured.', retryable: false }
      if (input.statusCallback) params.set('StatusCallback', input.statusCallback)
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
        })
        const json = await res.json().catch(() => null)
        if (res.ok && json?.sid) return { ok: true, id: json.sid }
        const code = json?.code ? String(json.code) : undefined
        return { ok: false, error: json?.message || `Twilio returned ${res.status}`, code, retryable: res.status === 429 || res.status >= 500 || (!!code && RETRYABLE_CODES.includes(code)) }
      } catch (error) {
        // The request never got an answer: it may or may not have been accepted, so it is safe to try again
        // only because Twilio de-duplicates nothing for us. We retry, and the message key keeps us to one row.
        return { ok: false, error: error instanceof Error ? error.message : 'SMS request failed', retryable: true }
      }
    },
  }
}

let override: SmsProvider | null | undefined
/** Tests swap in a fake carrier (or `null` for "not configured"); `undefined` restores the real one. */
export function setSmsProviderForTests(provider: SmsProvider | null | undefined) {
  override = provider
}

/**
 * A stand-in carrier for local development and automated tests: SMS_PROVIDER=simulate.
 * It sends nothing. Numbers ending 0001 are refused as invalid, 0002 as opted out at the
 * carrier and 0003 as a temporary outage; everything else is accepted. It is ignored in
 * production, where only real credentials can make a message leave.
 */
function simulator(): SmsProvider | null {
  if (process.env.SMS_PROVIDER !== 'simulate' || process.env.NODE_ENV === 'production') return null
  return {
    name: 'simulated',
    async send(input) {
      if (!input.from && !process.env.TWILIO_MESSAGING_SERVICE_SID) return { ok: false, error: 'No sending number is configured.', retryable: false }
      if (input.to.endsWith('0001')) return { ok: false, error: `The 'To' number ${input.to} is not a valid phone number.`, code: '21211', retryable: false }
      if (input.to.endsWith('0002')) return { ok: false, error: 'Attempt to send to unsubscribed recipient', code: '21610', retryable: false }
      if (input.to.endsWith('0003')) return { ok: false, error: 'Too many requests', code: '20429', retryable: true }
      return { ok: true, id: `SM${randomBytes(16).toString('hex')}` }
    },
  }
}

export function getSmsProvider(): SmsProvider | null {
  if (override !== undefined) return override
  return simulator() || twilio()
}

/** The installation-wide sending number, used by gyms that do not have their own. */
export function defaultSmsNumber(): string | null {
  const raw = process.env.TWILIO_FROM_NUMBER
  return raw ? toE164(raw) : null
}

/** The public address Twilio calls us on. Signatures are computed over this exact URL. */
export function webhookBase(): string | null {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  return base ? base.replace(/\/$/, '') : null
}

/**
 * Twilio signs each webhook: base64(HMAC-SHA1(authToken, url + every POST field sorted by name,
 * each as name immediately followed by value)). Anything that fails this did not come from Twilio.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

export function validTwilioSignature(signature: string | null, urls: string[], params: Record<string, string>, authToken = process.env.TWILIO_AUTH_TOKEN) {
  if (!signature || !authToken) return false
  const given = Buffer.from(signature)
  return urls.some((url) => {
    const expected = Buffer.from(twilioSignature(authToken, url, params))
    return expected.length === given.length && timingSafeEqual(expected, given)
  })
}

/**
 * The one canonical form for a phone number: E.164 ("+12075550142"). US and Canadian numbers
 * may be written any way people write them; other countries need the leading +.
 * Returns null for anything that cannot be a real number, so a typo never becomes a recipient.
 */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1') && /^[2-9]/.test(digits.slice(1))) return `+${digits}`
  return null
}

/** True when two numbers are the same phone, however each was typed. */
export function samePhone(a: string | null | undefined, b: string | null | undefined) {
  const x = toE164(a)
  return !!x && x === toE164(b)
}
