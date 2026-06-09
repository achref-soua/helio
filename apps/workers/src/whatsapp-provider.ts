export type WhatsAppResult = 'sent' | 'invalid' | 'failed';

/** Delivery adapter for WhatsApp. Swappable behind this interface. */
export interface WhatsAppProvider {
  send(to: string, body: string): Promise<WhatsAppResult>;
}

export interface WhatsAppConfig {
  /** The WhatsApp Business phone-number id from the Meta app. */
  phoneNumberId: string;
  accessToken: string;
  /** Graph API version. */
  apiVersion?: string;
}

/** WhatsApp Cloud API (Meta Graph) adapter — sends a text message. */
export class CloudWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly config: WhatsAppConfig) {}

  async send(to: string, body: string): Promise<WhatsAppResult> {
    const version = this.config.apiVersion ?? 'v21.0';
    const url = `https://graph.facebook.com/${version}/${this.config.phoneNumberId}/messages`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return 'sent';
      // 400 = bad recipient/number; not retryable.
      if (response.status === 400) return 'invalid';
      return 'failed';
    } catch {
      return 'failed';
    }
  }
}

/** Test double: records sends; can mark numbers as failing. */
export class InMemoryWhatsAppProvider implements WhatsAppProvider {
  readonly sent: Array<{ to: string; body: string }> = [];
  failing = new Set<string>();

  send(to: string, body: string): Promise<WhatsAppResult> {
    if (this.failing.has(to)) return Promise.resolve('failed');
    this.sent.push({ to, body });
    return Promise.resolve('sent');
  }
}
