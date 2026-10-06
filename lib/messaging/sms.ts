// SMS provider boundary. No provider is configured by default: SMS messages are
// recorded with status "skipped" so the rest of the pipeline (templates,
// automations, opt-in rules, history) works the same once one is added.
//
// Twilio is supported through its REST API when TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are set.

export interface SmsProvider {
  name: string
  send(to: string, body: string): Promise<{ ok: true; id: string } | { ok: false; error: string }>
}

export function getSmsProvider(): SmsProvider | null {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (!sid || !token || !from) return null
  return {
    name: 'twilio',
    async send(to, body) {
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: from, Body: body }),
        })
        const json = await res.json()
        if (!res.ok) return { ok: false, error: json?.message || `Twilio returned ${res.status}` }
        return { ok: true, id: json.sid }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'SMS request failed' }
      }
    },
  }
}

/** Best-effort E.164 normalisation for US numbers. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (phone.trim().startsWith('+') && digits.length >= 8) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}
