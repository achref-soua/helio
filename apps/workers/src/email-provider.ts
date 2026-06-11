import type { EmailProvider, OutgoingEmail } from '@helio/core';
import nodemailer, { type Transporter } from 'nodemailer';

// The adapter boundary and the fetch-based providers live in @helio/core
// (shared with the dashboard's system mail); SMTP is nodemailer, so it
// stays here. Re-exported to keep the app-local import path stable.
export {
  type EmailProvider,
  MailgunEmailProvider,
  type OutgoingEmail,
  PostmarkEmailProvider,
  ResendEmailProvider,
} from '@helio/core';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
}

/** Works with any relay; Mailpit in dev catches everything. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: Transporter;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
    });
  }

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const info = await this.transporter.sendMail(message);
    return { providerMessageId: info.messageId };
  }
}

/** Test double: records messages; can fail specific recipients. */
export class InMemoryEmailProvider implements EmailProvider {
  readonly sent: OutgoingEmail[] = [];
  failFor = new Set<string>();

  send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    if (this.failFor.has(message.to)) {
      return Promise.reject(new Error(`delivery refused for ${message.to}`));
    }
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `mem-${this.sent.length}` });
  }
}
