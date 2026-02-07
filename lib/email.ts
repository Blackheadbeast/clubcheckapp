import { Resend } from 'resend'

let resendInstance: Resend | null = null

function getResend() {
  if (!resendInstance) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not set')
    }
    resendInstance = new Resend(process.env.RESEND_API_KEY)
  }
  return resendInstance
}

export async function sendQrCodeEmail(
  memberEmail: string,
  memberName: string,
  qrCodeDataUrl: string,
  subject: string
) {
  try {
    const resend = getResend()

    const base64Data = qrCodeDataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    const { data, error } = await resend.emails.send({
      from: 'ClubCheck <noreply@clubcheckapp.com>',
      to: memberEmail,
      subject,
      attachments: [
        { filename: 'qr-code.png', content: buffer },
      ],
      html: buildQrEmailHtml(memberName, subject.includes('Welcome')),
    })

    if (error) {
      console.error('Email send error:', error)
      return { success: false, error }
    }
    return { success: true, data }
  } catch (error) {
    console.error('Email send exception:', error)
    return { success: false, error }
  }
}

function buildQrEmailHtml(memberName: string, isWelcome: boolean): string {
  const heading = isWelcome ? 'Welcome to ClubCheck!' : 'Your QR Code'
  const intro = isWelcome
    ? "You've been added to the gym! Your personal QR code for check-ins is attached to this email."
    : "Here's your updated QR code for check-ins. It's attached to this email."

  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" style="max-width:600px;background:linear-gradient(to bottom,#1a1a1a,#171717);border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr><td style="padding:40px 40px 20px;text-align:center;">
            <div style="display:inline-block;width:50px;height:50px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:12px;margin-bottom:16px;">
              <span style="color:#000;font-size:28px;font-weight:bold;line-height:50px;">C</span>
            </div>
            <h1 style="margin:0;color:#f59e0b;font-size:28px;font-weight:bold;">${heading}</h1>
          </td></tr>
          <tr><td style="padding:20px 40px;">
            <p style="color:#e5e5e5;font-size:16px;line-height:1.6;margin:0 0 20px;">Hi ${memberName},</p>
            <p style="color:#a3a3a3;font-size:16px;line-height:1.6;margin:0 0 30px;">${intro}</p>
            <div style="background-color:rgba(245,158,11,0.1);border-left:4px solid #f59e0b;padding:20px;border-radius:8px;margin-bottom:30px;">
              <h3 style="margin:0 0 12px;color:#f59e0b;font-size:18px;">How to Check In:</h3>
              <ol style="margin:0;padding-left:20px;color:#a3a3a3;font-size:14px;line-height:1.8;">
                <li><strong>Download the QR code</strong> attached to this email</li>
                <li><strong>Save it to your phone</strong> (photo gallery or favorites)</li>
                <li><strong>Show it at the front desk</strong> when you arrive</li>
              </ol>
            </div>
            <div style="background-color:rgba(245,158,11,0.05);border-radius:8px;padding:16px;margin-bottom:20px;">
              <p style="color:#f59e0b;font-size:14px;margin:0;font-weight:bold;">Your QR code is attached as "qr-code.png"</p>
            </div>
          </td></tr>
          <tr><td style="padding:30px 40px;text-align:center;border-top:1px solid #2a2a2a;">
            <p style="color:#737373;font-size:12px;margin:0;">Powered by <span style="color:#f59e0b;font-weight:bold;">ClubCheck</span></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

export async function sendPaymentFailedEmail(ownerEmail: string) {
  try {
    const resend = getResend()

    const { data, error } = await resend.emails.send({
      from: 'ClubCheck <noreply@clubcheckapp.com>',
      to: ownerEmail,
      subject: 'Payment Failed - Action Required',
      html: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" style="max-width:600px;background:linear-gradient(to bottom,#1a1a1a,#171717);border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr><td style="padding:40px 40px 20px;text-align:center;">
            <div style="display:inline-block;width:50px;height:50px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:12px;margin-bottom:16px;">
              <span style="color:#000;font-size:28px;font-weight:bold;line-height:50px;">C</span>
            </div>
            <h1 style="margin:0;color:#ef4444;font-size:28px;font-weight:bold;">Payment Failed</h1>
          </td></tr>
          <tr><td style="padding:20px 40px;">
            <p style="color:#e5e5e5;font-size:16px;line-height:1.6;margin:0 0 20px;">Your latest subscription payment could not be processed.</p>
            <p style="color:#a3a3a3;font-size:16px;line-height:1.6;margin:0 0 30px;">Please update your payment method to avoid any interruption to your ClubCheck service.</p>
            <div style="background-color:rgba(239,68,68,0.1);border-left:4px solid #ef4444;padding:20px;border-radius:8px;margin-bottom:30px;">
              <p style="margin:0;color:#fca5a5;font-size:14px;line-height:1.6;">Log in to your ClubCheck dashboard to update your billing information. If the issue persists, contact your bank or card issuer.</p>
            </div>
          </td></tr>
          <tr><td style="padding:30px 40px;text-align:center;border-top:1px solid #2a2a2a;">
            <p style="color:#737373;font-size:12px;margin:0;">Powered by <span style="color:#f59e0b;font-weight:bold;">ClubCheck</span></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    })

    if (error) {
      console.error('Payment failed email error:', error)
      return { success: false, error }
    }
    return { success: true, data }
  } catch (error) {
    console.error('Payment failed email exception:', error)
    return { success: false, error }
  }
}

export async function sendWaiverEmail(
  memberEmail: string,
  memberName: string,
  gymName: string,
  waiverLink: string
) {
  try {
    const resend = getResend()

    const { data, error } = await resend.emails.send({
      from: 'ClubCheck <noreply@clubcheckapp.com>',
      to: memberEmail,
      subject: `${gymName} - Please Sign Your Liability Waiver`,
      html: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" style="max-width:600px;background:linear-gradient(to bottom,#1a1a1a,#171717);border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr><td style="padding:40px 40px 20px;text-align:center;">
            <div style="display:inline-block;width:50px;height:50px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:12px;margin-bottom:16px;">
              <span style="color:#000;font-size:28px;font-weight:bold;line-height:50px;">C</span>
            </div>
            <h1 style="margin:0;color:#f59e0b;font-size:28px;font-weight:bold;">Waiver Required</h1>
          </td></tr>
          <tr><td style="padding:20px 40px;">
            <p style="color:#e5e5e5;font-size:16px;line-height:1.6;margin:0 0 20px;">Hi ${memberName},</p>
            <p style="color:#a3a3a3;font-size:16px;line-height:1.6;margin:0 0 30px;">
              Before your first visit to <strong style="color:#e5e5e5;">${gymName}</strong>, please sign our liability waiver. This is a one-time requirement.
            </p>
            <div style="text-align:center;margin:30px 0;">
              <a href="${waiverLink}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-size:16px;font-weight:bold;text-decoration:none;padding:16px 40px;border-radius:8px;">
                Sign Waiver Now
              </a>
            </div>
            <div style="background-color:rgba(245,158,11,0.1);border-left:4px solid #f59e0b;padding:20px;border-radius:8px;margin-bottom:20px;">
              <p style="margin:0;color:#a3a3a3;font-size:14px;line-height:1.6;">
                <strong style="color:#f59e0b;">Important:</strong> You must sign this waiver before you can check in at the gym.
              </p>
            </div>
            <p style="color:#737373;font-size:12px;margin:0;">
              If the button doesn't work, copy this link:<br>
              <a href="${waiverLink}" style="color:#f59e0b;word-break:break-all;">${waiverLink}</a>
            </p>
          </td></tr>
          <tr><td style="padding:30px 40px;text-align:center;border-top:1px solid #2a2a2a;">
            <p style="color:#737373;font-size:12px;margin:0;">Powered by <span style="color:#f59e0b;font-weight:bold;">ClubCheck</span></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    })

    if (error) {
      console.error('Waiver email error:', error)
      return { success: false, error }
    }
    return { success: true, data }
  } catch (error) {
    console.error('Waiver email exception:', error)
    return { success: false, error }
  }
}

export async function sendOwnerWelcomeEmail(ownerEmail: string) {
  try {
    const resend = getResend()

    const { data, error } = await resend.emails.send({
      from: 'ClubCheck <noreply@clubcheckapp.com>',
      to: ownerEmail,
      subject: 'Welcome to ClubCheck - Your 14-Day Trial Has Started!',
      html: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" style="max-width:600px;background:linear-gradient(to bottom,#1a1a1a,#171717);border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr><td style="padding:40px 40px 20px;text-align:center;">
            <div style="display:inline-block;width:60px;height:60px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:16px;margin-bottom:16px;">
              <span style="color:#000;font-size:32px;font-weight:bold;line-height:60px;">C</span>
            </div>
            <h1 style="margin:0;color:#f59e0b;font-size:28px;font-weight:bold;">Welcome to ClubCheck!</h1>
            <p style="color:#a3a3a3;font-size:16px;margin:12px 0 0;">Your gym management just got easier</p>
          </td></tr>

          <tr><td style="padding:20px 40px;">
            <div style="background:linear-gradient(135deg,rgba(245,158,11,0.15),rgba(217,119,6,0.1));border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;">
              <p style="color:#f59e0b;font-size:18px;font-weight:bold;margin:0;">Your 14-day free trial has started!</p>
              <p style="color:#a3a3a3;font-size:14px;margin:8px 0 0;">Full access to all features. No credit card required.</p>
            </div>

            <h2 style="color:#e5e5e5;font-size:18px;margin:0 0 16px;font-weight:600;">Get Started in 3 Steps:</h2>

            <div style="margin-bottom:16px;">
              <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
                <div style="width:28px;height:28px;background:#f59e0b;border-radius:50%;color:#000;font-weight:bold;font-size:14px;line-height:28px;text-align:center;flex-shrink:0;">1</div>
                <div style="margin-left:12px;">
                  <p style="color:#e5e5e5;font-size:15px;margin:0;font-weight:600;">Set up your gym profile</p>
                  <p style="color:#737373;font-size:13px;margin:4px 0 0;">Add your gym name, logo, and address in Settings.</p>
                </div>
              </div>
              <div style="display:flex;align-items:flex-start;margin-bottom:16px;">
                <div style="width:28px;height:28px;background:#f59e0b;border-radius:50%;color:#000;font-weight:bold;font-size:14px;line-height:28px;text-align:center;flex-shrink:0;">2</div>
                <div style="margin-left:12px;">
                  <p style="color:#e5e5e5;font-size:15px;margin:0;font-weight:600;">Add your first member</p>
                  <p style="color:#737373;font-size:13px;margin:4px 0 0;">They'll receive a QR code for instant check-ins.</p>
                </div>
              </div>
              <div style="display:flex;align-items:flex-start;">
                <div style="width:28px;height:28px;background:#f59e0b;border-radius:50%;color:#000;font-weight:bold;font-size:14px;line-height:28px;text-align:center;flex-shrink:0;">3</div>
                <div style="margin-left:12px;">
                  <p style="color:#e5e5e5;font-size:15px;margin:0;font-weight:600;">Set up your kiosk</p>
                  <p style="color:#737373;font-size:13px;margin:4px 0 0;">Create a PIN and use any tablet as a check-in station.</p>
                </div>
              </div>
            </div>

            <div style="text-align:center;margin:32px 0;">
              <a href="https://clubcheckapp.com/dashboard" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;">
                Go to Dashboard
              </a>
            </div>

            <div style="background-color:rgba(255,255,255,0.03);border-radius:8px;padding:16px;margin-top:24px;">
              <p style="color:#a3a3a3;font-size:14px;margin:0;line-height:1.6;">
                <strong style="color:#e5e5e5;">Need help?</strong> Reply to this email or check our help docs in the dashboard. We're here to help you succeed!
              </p>
            </div>
          </td></tr>

          <tr><td style="padding:30px 40px;text-align:center;border-top:1px solid #2a2a2a;">
            <p style="color:#737373;font-size:12px;margin:0;">
              You're receiving this because you signed up for <span style="color:#f59e0b;font-weight:bold;">ClubCheck</span>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    })

    if (error) {
      console.error('Owner welcome email error:', error)
      return { success: false, error }
    }
    return { success: true, data }
  } catch (error) {
    console.error('Owner welcome email exception:', error)
    return { success: false, error }
  }
}

export async function sendMemberWelcomeEmail(
  memberEmail: string,
  memberName: string,
  qrCodeDataUrl: string
) {
  try {
    const resend = getResend()
    
    // Convert data URL to buffer
    const base64Data = qrCodeDataUrl.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    const { data, error } = await resend.emails.send({
      from: 'ClubCheck <noreply@clubcheckapp.com>',
      to: memberEmail,
      subject: `Welcome to the Gym - Your ClubCheck QR Code`,
      attachments: [
        {
          filename: 'qr-code.png',
          content: buffer,
        },
      ],
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
              <tr>
                <td align="center">
                  <table width="100%" style="max-width: 600px; background: linear-gradient(to bottom, #1a1a1a, #171717); border-radius: 16px; overflow: hidden; border: 1px solid #2a2a2a;">
                    <tr>
                      <td style="padding: 40px 40px 20px; text-align: center;">
                        <div style="display: inline-block; width: 50px; height: 50px; background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 12px; margin-bottom: 16px;">
                          <span style="color: #000; font-size: 28px; font-weight: bold; line-height: 50px;">C</span>
                        </div>
                        <h1 style="margin: 0; color: #f59e0b; font-size: 28px; font-weight: bold;">Welcome to ClubCheck!</h1>
                      </td>
                    </tr>
                    
                    <tr>
                      <td style="padding: 20px 40px;">
                        <p style="color: #e5e5e5; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                          Hi ${memberName},
                        </p>
                        <p style="color: #a3a3a3; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
                          You've been added to the gym! Your personal QR code for check-ins is attached to this email.
                        </p>
                        
                        <div style="background-color: rgba(245, 158, 11, 0.1); border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                          <h3 style="margin: 0 0 12px; color: #f59e0b; font-size: 18px;">How to Check In:</h3>
                          <ol style="margin: 0; padding-left: 20px; color: #a3a3a3; font-size: 14px; line-height: 1.8;">
                            <li><strong>Download the QR code</strong> attached to this email</li>
                            <li><strong>Save it to your phone</strong> (photo gallery or favorites)</li>
                            <li><strong>Show it at the front desk</strong> when you arrive</li>
                            <li>Get instant check-in - that&apos;s it!</li>
                          </ol>
                        </div>
                        
                        <div style="background-color: rgba(245, 158, 11, 0.05); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                          <p style="color: #f59e0b; font-size: 14px; margin: 0; font-weight: bold;">
                            📎 Your QR code is attached as &quot;qr-code.png&quot;
                          </p>
                        </div>
                        
                        <p style="color: #737373; font-size: 14px; line-height: 1.6; margin: 0;">
                          <strong>Tip:</strong> Add this QR code to your phone&apos;s home screen for quick access!
                        </p>
                      </td>
                    </tr>
                    
                    <tr>
                      <td style="padding: 30px 40px; text-align: center; border-top: 1px solid #2a2a2a;">
                        <p style="color: #737373; font-size: 12px; margin: 0;">
                          Powered by <span style="color: #f59e0b; font-weight: bold;">ClubCheck</span>
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    })

    if (error) {
      console.error('Email send error:', error)
      return { success: false, error }
    }

    return { success: true, data }
  } catch (error) {
    console.error('Email send exception:', error)
    return { success: false, error }
  }
}

export async function sendVerificationEmail(
  ownerEmail: string,
  verificationToken: string
) {
  try {
    const resend = getResend()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://clubcheckapp.com'
    const verificationLink = `${baseUrl}/verify-email/${verificationToken}`

    const { data, error } = await resend.emails.send({
      from: 'ClubCheck <noreply@clubcheckapp.com>',
      to: ownerEmail,
      subject: 'Verify Your Email - ClubCheck',
      html: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" style="max-width:600px;background:linear-gradient(to bottom,#1a1a1a,#171717);border-radius:16px;overflow:hidden;border:1px solid #2a2a2a;">
          <tr><td style="padding:40px 40px 20px;text-align:center;">
            <div style="display:inline-block;width:60px;height:60px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:16px;margin-bottom:16px;">
              <span style="color:#000;font-size:32px;font-weight:bold;line-height:60px;">C</span>
            </div>
            <h1 style="margin:0;color:#f59e0b;font-size:28px;font-weight:bold;">Verify Your Email</h1>
            <p style="color:#a3a3a3;font-size:16px;margin:12px 0 0;">One click to activate your account</p>
          </td></tr>

          <tr><td style="padding:20px 40px;">
            <p style="color:#e5e5e5;font-size:16px;line-height:1.6;margin:0 0 20px;">
              Thanks for signing up for ClubCheck! Please verify your email address to activate your account and start your 14-day free trial.
            </p>

            <div style="text-align:center;margin:32px 0;">
              <a href="${verificationLink}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-size:16px;font-weight:bold;text-decoration:none;padding:16px 40px;border-radius:8px;">
                Verify My Email
              </a>
            </div>

            <div style="background-color:rgba(245,158,11,0.1);border-left:4px solid #f59e0b;padding:20px;border-radius:8px;margin-bottom:20px;">
              <p style="margin:0;color:#a3a3a3;font-size:14px;line-height:1.6;">
                <strong style="color:#f59e0b;">This link expires in 24 hours.</strong><br>
                If you didn't create an account with ClubCheck, you can safely ignore this email.
              </p>
            </div>

            <p style="color:#737373;font-size:12px;margin:0;">
              If the button doesn't work, copy this link:<br>
              <a href="${verificationLink}" style="color:#f59e0b;word-break:break-all;">${verificationLink}</a>
            </p>
          </td></tr>

          <tr><td style="padding:30px 40px;text-align:center;border-top:1px solid #2a2a2a;">
            <p style="color:#737373;font-size:12px;margin:0;">
              Powered by <span style="color:#f59e0b;font-weight:bold;">ClubCheck</span>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    })

    if (error) {
      console.error('Verification email error:', error)
      return { success: false, error }
    }
    return { success: true, data }
  } catch (error) {
    console.error('Verification email exception:', error)
    return { success: false, error }
  }
}

export async function sendFeedbackNotificationEmail(
  rating: number,
  message: string | null,
  ownerEmail: string,
  ownerId: string
) {
  try {
    const resend = getResend()
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating)

    const { data, error } = await resend.emails.send({
      from: 'ClubCheck <noreply@clubcheckapp.com>',
      to: 'feedback@clubcheckapp.com',
      subject: `[Feedback] ${rating}/5 stars from ${ownerEmail}`,
      html: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 20px;">
      <tr><td align="center">
        <table width="100%" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          <tr><td style="padding:30px;background:#f59e0b;text-align:center;">
            <h1 style="margin:0;color:#000;font-size:24px;font-weight:bold;">New Feedback Received</h1>
          </td></tr>

          <tr><td style="padding:30px;">
            <div style="text-align:center;margin-bottom:24px;">
              <span style="font-size:32px;color:#f59e0b;">${stars}</span>
              <p style="color:#333;font-size:18px;margin:8px 0 0;font-weight:600;">${rating} out of 5 stars</p>
            </div>

            <div style="background-color:#f9f9f9;border-radius:8px;padding:20px;margin-bottom:20px;">
              <p style="color:#666;font-size:14px;margin:0 0 4px;font-weight:600;">From:</p>
              <p style="color:#333;font-size:16px;margin:0;">${ownerEmail}</p>
            </div>

            ${message ? `
            <div style="background-color:#f9f9f9;border-radius:8px;padding:20px;margin-bottom:20px;">
              <p style="color:#666;font-size:14px;margin:0 0 8px;font-weight:600;">Message:</p>
              <p style="color:#333;font-size:16px;margin:0;line-height:1.6;">${message}</p>
            </div>
            ` : ''}

            <div style="border-top:1px solid #eee;padding-top:16px;margin-top:16px;">
              <p style="color:#999;font-size:12px;margin:0;">Owner ID: ${ownerId}</p>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    })

    if (error) {
      console.error('Feedback notification email error:', error)
      return { success: false, error }
    }
    return { success: true, data }
  } catch (error) {
    console.error('Feedback notification email exception:', error)
    return { success: false, error }
  }
}