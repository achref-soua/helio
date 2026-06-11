import { describe, expect, it } from 'vitest';

import { probeOutcome, probeRequestFor } from '../src/credential-probes';
import { CREDENTIAL_KINDS } from '../src/credentials';

describe('probeRequestFor', () => {
  it('covers every kind: an http probe or the documented custom path', () => {
    const samples: Record<string, [Record<string, unknown>, Record<string, string>]> = {
      EMAIL_SMTP: [{ host: 'h', port: 25 }, {}],
      EMAIL_POSTMARK: [{}, { serverToken: 't' }],
      EMAIL_RESEND: [{}, { apiKey: 'k' }],
      EMAIL_MAILGUN: [{ domain: 'mg.acme.test', region: 'us' }, { apiKey: 'k' }],
      SMS_TWILIO: [{ accountSid: 'AC' + 'a'.repeat(32) }, { authToken: 't' }],
      WHATSAPP_CLOUD: [{ phoneNumberId: '123' }, { accessToken: 't' }],
      LLM: [{ provider: 'groq', model: 'm' }, { apiKey: 'k' }],
      CHURN_ENDPOINT: [{ url: 'https://m.test/churn' }, {}],
      IMPORT_HUBSPOT: [{}, { accessToken: 't' }],
      IMPORT_MAILCHIMP: [{}, { apiKey: 'abc-us21' }],
      IMPORT_KLAVIYO: [{}, { apiKey: 'pk' }],
    };
    for (const kind of CREDENTIAL_KINDS) {
      const [config, secrets] = samples[kind]!;
      const probe = probeRequestFor(kind, config, secrets);
      if (kind === 'EMAIL_SMTP') {
        expect(probe).toBeNull();
      } else {
        expect(probe!.url).toMatch(/^https?:\/\//);
      }
    }
  });

  it('builds provider-correct auth headers', () => {
    const twilio = probeRequestFor(
      'SMS_TWILIO',
      { accountSid: 'AC' + 'a'.repeat(32) },
      { authToken: 'secret' },
    )!;
    expect(twilio.headers.authorization).toMatch(/^Basic /);
    expect(twilio.url).toContain('/Accounts/AC');

    const anthropic = probeRequestFor(
      'LLM',
      { provider: 'anthropic', model: 'claude' },
      { apiKey: 'sk-ant' },
    )!;
    expect(anthropic.headers['x-api-key']).toBe('sk-ant');
    expect(anthropic.headers['anthropic-version']).toBeDefined();

    const local = probeRequestFor(
      'LLM',
      { provider: 'local', model: 'm', baseUrl: 'http://10.0.0.5:8000/v1/' },
      {},
    )!;
    expect(local.url).toBe('http://10.0.0.5:8000/v1/models');
    expect(local.headers.authorization).toBeUndefined();
  });

  it('routes mailgun by region and rejects mailchimp keys without a dc', () => {
    expect(
      probeRequestFor('EMAIL_MAILGUN', { domain: 'mg.a.test', region: 'eu' }, { apiKey: 'k' })!.url,
    ).toContain('api.eu.mailgun.net');
    expect(() => probeRequestFor('IMPORT_MAILCHIMP', {}, { apiKey: 'no-suffix' })).toThrowError(
      /datacenter suffix/,
    );
  });
});

describe('probeOutcome', () => {
  it('maps statuses to human verdicts', () => {
    expect(probeOutcome('EMAIL_POSTMARK', 200).ok).toBe(true);
    expect(probeOutcome('EMAIL_POSTMARK', 401)).toEqual({
      ok: false,
      message: 'The provider rejected these credentials',
    });
    expect(probeOutcome('EMAIL_MAILGUN', 404).message).toMatch(/identifiers/);
    expect(probeOutcome('EMAIL_RESEND', 500).message).toContain('500');
  });

  it('treats any non-5xx as reachable for churn endpoints', () => {
    expect(probeOutcome('CHURN_ENDPOINT', 405).ok).toBe(true);
    expect(probeOutcome('CHURN_ENDPOINT', 503).ok).toBe(false);
  });
});
