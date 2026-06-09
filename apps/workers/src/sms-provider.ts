export type SmsResult = 'sent' | 'invalid' | 'failed';

/** Delivery adapter for SMS. Swappable behind this interface (Twilio today). */
export interface SmsProvider {
  send(to: string, body: string): Promise<SmsResult>;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The sending number or messaging-service SID in E.164. */
  from: string;
}

/** Twilio Programmable Messaging adapter over the REST API. */
export class TwilioSmsProvider implements SmsProvider {
  constructor(private readonly config: TwilioConfig) {}

  async send(to: string, body: string): Promise<SmsResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString(
      'base64',
    );
    const form = new URLSearchParams({ To: to, From: this.config.from, Body: body });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Basic ${auth}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return 'sent';
      // 400 = unroutable/invalid number; the contact's phone is bad, not retryable.
      if (response.status === 400) return 'invalid';
      return 'failed';
    } catch {
      return 'failed';
    }
  }
}

/** Test double: records sends; can mark numbers as failing. */
export class InMemorySmsProvider implements SmsProvider {
  readonly sent: Array<{ to: string; body: string }> = [];
  failing = new Set<string>();

  send(to: string, body: string): Promise<SmsResult> {
    if (this.failing.has(to)) return Promise.resolve('failed');
    this.sent.push({ to, body });
    return Promise.resolve('sent');
  }
}
