import type { CredentialKind, LlmProvider } from './credentials';

/**
 * Connectivity probes for vault credentials: cheap, read-only provider
 * calls that prove a credential authenticates without sending anything.
 * Pure descriptor builders — the web server executes them with fetch and
 * a timeout; SMTP (a socket, not HTTP) is the one custom path and returns
 * null here.
 */

export interface ProbeRequest {
  url: string;
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
}

function basicAuth(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

function llmProbe(config: Record<string, unknown>, apiKey: string | undefined): ProbeRequest {
  const provider = config.provider as LlmProvider;
  const bearer: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  switch (provider) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models',
        method: 'GET',
        headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' },
      };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', method: 'GET', headers: bearer };
    case 'groq':
      return { url: 'https://api.groq.com/openai/v1/models', method: 'GET', headers: bearer };
    case 'ollama':
    case 'local': {
      const base =
        typeof config.baseUrl === 'string' ? config.baseUrl : 'http://localhost:11434/v1';
      return { url: `${base.replace(/\/$/, '')}/models`, method: 'GET', headers: bearer };
    }
  }
}

/**
 * Build the HTTP probe for a kind, or null when verification needs a
 * custom (non-HTTP) path. Throws a user-readable Error when the inputs
 * cannot form a probe (e.g. a Mailchimp key without its dc suffix).
 */
export function probeRequestFor(
  kind: CredentialKind,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): ProbeRequest | null {
  switch (kind) {
    case 'EMAIL_SMTP':
      return null; // socket check, handled by the executor
    case 'EMAIL_POSTMARK':
      return {
        url: 'https://api.postmarkapp.com/server',
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-postmark-server-token': secrets.serverToken ?? '',
        },
      };
    case 'EMAIL_RESEND':
      return {
        url: 'https://api.resend.com/domains',
        method: 'GET',
        headers: { authorization: `Bearer ${secrets.apiKey ?? ''}` },
      };
    case 'EMAIL_MAILGUN': {
      const host =
        config.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
      return {
        url: `${host}/v3/domains/${encodeURIComponent(String(config.domain ?? ''))}`,
        method: 'GET',
        headers: { authorization: basicAuth('api', secrets.apiKey ?? '') },
      };
    }
    case 'SMS_TWILIO': {
      const sid = String(config.accountSid ?? '');
      return {
        url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
        method: 'GET',
        headers: { authorization: basicAuth(sid, secrets.authToken ?? '') },
      };
    }
    case 'WHATSAPP_CLOUD':
      return {
        url: `https://graph.facebook.com/v20.0/${encodeURIComponent(String(config.phoneNumberId ?? ''))}?fields=id`,
        method: 'GET',
        headers: { authorization: `Bearer ${secrets.accessToken ?? ''}` },
      };
    case 'LLM':
      return llmProbe(config, secrets.apiKey);
    case 'CHURN_ENDPOINT':
      return { url: String(config.url ?? ''), method: 'HEAD', headers: {} };
    case 'IMPORT_HUBSPOT':
      return {
        url: 'https://api.hubapi.com/crm/v3/objects/contacts?limit=1',
        method: 'GET',
        headers: { authorization: `Bearer ${secrets.accessToken ?? ''}` },
      };
    case 'IMPORT_MAILCHIMP': {
      const key = secrets.apiKey ?? '';
      const dc = key.split('-').pop() ?? '';
      if (!/^[a-z]{2,4}\d+$/.test(dc)) {
        throw new Error('Mailchimp keys end in a datacenter suffix, e.g. "-us21"');
      }
      return {
        url: `https://${dc}.api.mailchimp.com/3.0/ping`,
        method: 'GET',
        headers: { authorization: basicAuth('helio', key) },
      };
    }
    case 'IMPORT_KLAVIYO':
      return {
        url: 'https://a.klaviyo.com/api/accounts/',
        method: 'GET',
        headers: {
          authorization: `Klaviyo-API-Key ${secrets.apiKey ?? ''}`,
          revision: '2024-10-15',
        },
      };
  }
}

/** Map a probe's HTTP status to a verdict with a short, human message. */
export function probeOutcome(
  kind: CredentialKind,
  status: number,
): { ok: boolean; message: string } {
  // A churn endpoint only needs to exist and answer; the predict contract
  // (POST) is validated separately when the model is activated.
  if (kind === 'CHURN_ENDPOINT') {
    return status < 500
      ? { ok: true, message: 'Endpoint is reachable' }
      : { ok: false, message: `Endpoint answered HTTP ${status}` };
  }
  if (status >= 200 && status < 300) return { ok: true, message: 'Credentials verified' };
  if (status === 401 || status === 403) {
    return { ok: false, message: 'The provider rejected these credentials' };
  }
  if (status === 404) {
    return { ok: false, message: 'Not found — check the account/domain identifiers' };
  }
  return { ok: false, message: `The provider answered HTTP ${status}` };
}
