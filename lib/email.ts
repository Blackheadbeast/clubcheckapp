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
      from: process.env.EMAIL_FROM || 'ClubCheck <onboarding@resend.dev>',
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
                            <li>Get instant check-in - that's it!</li>
                          </ol>
                        </div>
                        
                        <div style="background-color: rgba(245, 158, 11, 0.05); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                          <p style="color: #f59e0b; font-size: 14px; margin: 0; font-weight: bold;">
                            📎 Your QR code is attached as "qr-code.png"
                          </p>
                        </div>
                        
                        <p style="color: #737373; font-size: 14px; line-height: 1.6; margin: 0;">
                          <strong>Tip:</strong> Add this QR code to your phone's home screen for quick access!
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