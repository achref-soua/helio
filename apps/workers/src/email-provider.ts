import nodemailer, { type Transporter } from 'nodemailer';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Delivery adapter boundary — SMTP today, SES/Postmark/Resend later. */
export interface EmailProvider {
  send(message: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

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
