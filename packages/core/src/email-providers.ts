/**
 * Email delivery adapters shared by the send pipeline (workers) and the
 * dashboard's system mail (invitations, test sends). Pure fetch — SMTP
 * lives per-app on nodemailer. Which adapter a send uses is resolved per
 * organization from the credential vault (ADR-0019).
 */

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface EmailProvider {
  send(message: OutgoingEmail): Promise<{ providerMessageId: string }>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function expectOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  const body = (await response.text().catch(() => '')).slice(0, 200);
  throw new Error(`${provider} answered ${response.status}: ${body}`);
}

/** Postmark transactional API (per-org server token). */
export class PostmarkEmailProvider implements EmailProvider {
  constructor(
    private readonly serverToken: string,
    private readonly messageStream?: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const response = await this.fetchImpl('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-postmark-server-token': this.serverToken,
      },
      body: JSON.stringify({
        From: message.from,
        To: message.to,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        ...(this.messageStream ? { MessageStream: this.messageStream } : {}),
        Headers: Object.entries(message.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
      }),
    });
    await expectOk(response, 'postmark');
    const body = (await response.json()) as { MessageID?: string };
    return { providerMessageId: body.MessageID ?? 'postmark' };
  }
}

/** Resend transactional API (per-org API key). */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers ?? {},
      }),
    });
    await expectOk(response, 'resend');
    const body = (await response.json()) as { id?: string };
    return { providerMessageId: body.id ?? 'resend' };
  }
}

/** Mailgun messages API (per-org key + sending domain). */
export class MailgunEmailProvider implements EmailProvider {
  constructor(
    private readonly options: { apiKey: string; domain: string; region?: 'us' | 'eu' },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: OutgoingEmail): Promise<{ providerMessageId: string }> {
    const host =
      this.options.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    const form = new URLSearchParams({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    for (const [name, value] of Object.entries(message.headers ?? {})) {
      form.set(`h:${name}`, value);
    }
    const response = await this.fetchImpl(
      `${host}/v3/${encodeURIComponent(this.options.domain)}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${btoa(`api:${this.options.apiKey}`)}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    await expectOk(response, 'mailgun');
    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { providerMessageId: body.id ?? 'mailgun' };
  }
}
