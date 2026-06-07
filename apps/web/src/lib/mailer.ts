import nodemailer from 'nodemailer';

import { env } from './env';

/**
 * Transactional mail transport. In development this is Mailpit, so nothing
 * ever leaves the machine. Real provider adapters (SES/Postmark/Resend)
 * arrive with the delivery phase — this surface stays the same.
 */
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

export async function sendMail(options: { to: string; subject: string; text: string }) {
  await transport.sendMail({ from: env.MAIL_FROM, ...options });
}
