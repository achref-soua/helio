import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  CREDENTIAL_KINDS,
  credentialKindsForChannel,
  credentialSpec,
  maskSecret,
  secretLast4,
  toMaskedCredential,
  validateCredentialInput,
} from '../src/credentials';

describe('credential registry', () => {
  it('every kind has a spec with a label, channel, and config schema', () => {
    for (const kind of CREDENTIAL_KINDS) {
      const spec = credentialSpec(kind);
      expect(spec.kind).toBe(kind);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.configSchema).toBeDefined();
    }
  });

  it('configFields stay in sync with each kind config schema', () => {
    for (const kind of CREDENTIAL_KINDS) {
      const spec = credentialSpec(kind);
      const shape = (spec.configSchema as z.ZodObject<z.ZodRawShape>).shape;
      expect(new Set(spec.configFields.map((field) => field.name))).toEqual(
        new Set(Object.keys(shape)),
      );
    }
  });

  it('groups kinds by channel for the settings UI', () => {
    expect(credentialKindsForChannel('email').map((spec) => spec.kind)).toEqual([
      'EMAIL_SMTP',
      'EMAIL_POSTMARK',
      'EMAIL_RESEND',
      'EMAIL_MAILGUN',
    ]);
    expect(credentialKindsForChannel('ai')).toHaveLength(1);
  });
});

describe('validateCredentialInput', () => {
  it('accepts a complete postmark credential', () => {
    const input = validateCredentialInput(
      {
        kind: 'EMAIL_POSTMARK',
        name: 'Production',
        config: { fromEmail: 'hello@acme.test', fromName: 'Acme' },
        secrets: { serverToken: 'pm-token-1234' },
      },
      { requireSecrets: true },
    );
    expect(input.config.fromEmail).toBe('hello@acme.test');
  });

  it('rejects config that fails the kind schema', () => {
    expect(() =>
      validateCredentialInput(
        {
          kind: 'SMS_TWILIO',
          name: 'Twilio',
          config: { accountSid: 'not-a-sid', fromNumber: '+15555550100' },
          secrets: { authToken: 'tok' },
        },
        { requireSecrets: true },
      ),
    ).toThrowError(/account SID/);
  });

  it('rejects unknown config keys (strict schemas)', () => {
    expect(() =>
      validateCredentialInput(
        {
          kind: 'EMAIL_RESEND',
          name: 'Resend',
          config: { fromEmail: 'a@b.test', smuggled: true },
          secrets: { apiKey: 'k' },
        },
        { requireSecrets: true },
      ),
    ).toThrowError();
  });

  it('rejects secrets that are not declared for the kind', () => {
    expect(() =>
      validateCredentialInput(
        {
          kind: 'EMAIL_RESEND',
          name: 'Resend',
          config: { fromEmail: 'a@b.test' },
          secrets: { apiKey: 'k', extra: 'nope' },
        },
        { requireSecrets: true },
      ),
    ).toThrowError(/unknown secret field/);
  });

  it('requires non-optional secrets on create but not on update', () => {
    const payload = {
      kind: 'WHATSAPP_CLOUD',
      name: 'WA',
      config: { phoneNumberId: '1234567890' },
      secrets: {},
    };
    expect(() => validateCredentialInput(payload, { requireSecrets: true })).toThrowError(
      /required/,
    );
    expect(() => validateCredentialInput(payload, { requireSecrets: false })).not.toThrowError();
  });

  it('lets keyless llm kinds (ollama/local) omit the api key even on create', () => {
    expect(() =>
      validateCredentialInput(
        {
          kind: 'LLM',
          name: 'Local Ollama',
          config: { provider: 'ollama', model: 'llama3.3', baseUrl: 'http://localhost:11434/v1' },
          secrets: {},
        },
        { requireSecrets: true },
      ),
    ).not.toThrowError();
  });
});

describe('masking', () => {
  it('keeps only the last 4 characters', () => {
    expect(secretLast4('sk-abcdef123456')).toBe('3456');
    expect(secretLast4('abc')).toBe('abc');
    expect(maskSecret('3456')).toBe('••••3456');
    expect(maskSecret(null)).toBe('••••••••');
  });

  it('toMaskedCredential never emits envelopes and only previews known fields', () => {
    const masked = toMaskedCredential({
      id: 'cred_1',
      kind: 'EMAIL_POSTMARK',
      name: 'Production',
      config: { fromEmail: 'hello@acme.test' },
      secretsMeta: {
        serverToken: { last4: '9f2a', setAt: '2026-06-11T00:00:00.000Z' },
        ghost: { last4: '0000', setAt: '2026-06-11T00:00:00.000Z' },
      },
      status: 'VERIFIED',
      lastVerifiedAt: new Date('2026-06-11T01:00:00Z'),
      lastError: null,
      updatedAt: new Date('2026-06-11T02:00:00Z'),
    });
    expect(masked.secretPreviews).toEqual({ serverToken: '••••9f2a' });
    expect(JSON.stringify(masked)).not.toContain('enc:v1');
    expect(masked.lastVerifiedAt).toBe('2026-06-11T01:00:00.000Z');
  });
});
