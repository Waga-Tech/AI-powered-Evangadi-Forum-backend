/**
 * Transactional email helper using Resend API.
 *
 * Resend is a modern email delivery platform with a simple API.
 * Set RESEND_API_KEY in .env to send emails.
 *
 * Documentation: https://resend.com/docs
 */
import { Resend } from 'resend';

const { RESEND_API_KEY, EMAIL_FROM } = process.env;

let resend = null;

function getResendClient() {
  if (!resend) {
    if (!RESEND_API_KEY) {
      throw new Error(
        'RESEND_API_KEY is not set in .env. Please add your Resend API key.'
      );
    }
    resend = new Resend(RESEND_API_KEY);
  }
  return resend;
}

/**
 * Send an email via Resend API.
 *
 * @param {{ to: string, subject: string, html: string, text?: string }} options
 */
export async function sendMail({ to, subject, html, text }) {
  try {
    const resendClient = getResendClient();

    const result = await resendClient.emails.send({
      from: EMAIL_FROM || 'Evangadi Forum <onboarding@resend.dev>',
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });

    if (result.error) {
      console.error('[mailer] Resend API error:', result.error);
      throw new Error(`Email send failed: ${result.error.message}`);
    }

    console.info('[mailer] Email sent successfully:', result.data.id);
    return result.data;
  } catch (error) {
    console.error('[mailer] Error sending email:', error.message);
    throw error;
  }
}

/**
 * Send a registration confirmation email.
 */
export async function sendConfirmationEmail({ to, firstName, confirmationUrl }) {
  const subject = 'Confirm your Evangadi Forum account';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${subject}</title>
    </head>
    <body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;max-width:100%;">
              <!-- Header -->
              <tr>
                <td style="background:#f97316;padding:28px 40px;">
                  <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em;">
                    Evangadi Forum
                  </h1>
                  <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">
                    Learn together. Ask with context.
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:40px 40px 32px;">
                  <h2 style="margin:0 0 12px;font-size:22px;color:#0f172a;font-weight:600;">
                    Welcome, ${firstName}! 👋
                  </h2>
                  <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.65;">
                    Your Evangadi Forum account was created successfully. Click the button below
                    to confirm your email address and start posting.
                  </p>

                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="border-radius:8px;background:#f97316;">
                        <a href="${confirmationUrl}"
                           style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
                          Confirm my email address
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
                    If the button doesn't work, copy and paste this link into your browser:<br />
                    <a href="${confirmationUrl}" style="color:#f97316;word-break:break-all;">${confirmationUrl}</a>
                  </p>

                  <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">
                    This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:20px 40px;border-top:1px solid #e2e8f0;background:#f8fafc;">
                  <p style="margin:0;font-size:12px;color:#94a3b8;">
                    © 2026 Evangadi Forum · For educational use only
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await sendMail({ to, subject, html });
}

/**
 * Send a password reset email.
 */
export async function sendPasswordResetEmail({ to, firstName, resetUrl }) {
  const subject = 'Reset your Evangadi Forum password';

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${subject}</title>
    </head>
    <body style="margin:0;padding:0;background:#f8fafc;font-family:system-ui,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;max-width:100%;">
              <tr>
                <td style="background:#f97316;padding:28px 40px;">
                  <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">Evangadi Forum</h1>
                  <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Learn together. Ask with context.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:40px 40px 32px;">
                  <h2 style="margin:0 0 12px;font-size:22px;color:#0f172a;font-weight:600;">
                    Password reset request
                  </h2>
                  <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.65;">
                    Hi ${firstName}, we received a request to reset the password for your account.
                    Click the button below to choose a new password. This link expires in 15 minutes.
                  </p>

                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="border-radius:8px;background:#f97316;">
                        <a href="${resetUrl}"
                           style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">
                          Reset my password
                        </a>
                      </td>
                    </tr>
                  </table>

                  <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
                    If the button doesn't work, copy and paste this link into your browser:<br />
                    <a href="${resetUrl}" style="color:#f97316;word-break:break-all;">${resetUrl}</a>
                  </p>

                  <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;">
                    If you didn't request a password reset, you can safely ignore this email.
                    Your password will not change.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 40px;border-top:1px solid #e2e8f0;background:#f8fafc;">
                  <p style="margin:0;font-size:12px;color:#94a3b8;">© 2026 Evangadi Forum · For educational use only</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  await sendMail({ to, subject, html });
}
