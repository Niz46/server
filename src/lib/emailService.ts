// server/src/lib/emailService.ts
import dotenv from 'dotenv';
import Mailgun from 'mailgun.js';
import formData from 'form-data';

dotenv.config();

const {
  MAILGUN_API_KEY,
  MAILGUN_DOMAIN,
  MAILGUN_SENDER_EMAIL,
  MAILGUN_SENDER_NAME,
} = process.env;

if (
  !MAILGUN_API_KEY ||
  !MAILGUN_DOMAIN ||
  !MAILGUN_SENDER_EMAIL ||
  !MAILGUN_SENDER_NAME
) {
  throw new Error(
    'Missing Mailgun config. Please set MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_SENDER_EMAIL, and MAILGUN_SENDER_NAME in .env'
  );
}

const mailgun = new Mailgun(formData);
const mg = mailgun.client({ username: 'api', key: MAILGUN_API_KEY });

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

/**
 * sendEmail — wraps Mailgun’s API for single-recipient sends.
 */
export async function sendEmail({ to, subject, text, html }: EmailOptions) {
  try {
    // Cast to any to satisfy TypeScript and align with Mailgun API payload
    const messageData: any = {
      from: `${MAILGUN_SENDER_NAME} <${MAILGUN_SENDER_EMAIL}>`,
      to: [to],
      subject,
      text,
      html,
    };

    const result = await mg.messages.create(MAILGUN_DOMAIN!, messageData);

    console.log(`✅ Mailgun: Sent to ${to}`, result);
    return result;
  } catch (err: any) {
    console.error('❌ Mailgun send error:', err.message || err);
    throw err;
  }
}
