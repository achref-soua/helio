import { encryptField, generateEncryptionKey } from '@helio/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = generateEncryptionKey();

vi.mock('../src/env', () => ({ env: { HELIO_ENCRYPTION_KEY: '' } }));

import { clearCredentialCache, type CredentialReader } from '../src/credential-store';
import { env } from '../src/env';
import { createSmsResolver, createWhatsAppResolver } from '../src/messaging-provider-factory';
import { InMemorySmsProvider, TwilioSmsProvider } from '../src/sms-provider';
import { CloudWhatsAppProvider } from '../src/whatsapp-provider';

function readerFor(row: unknown): CredentialReader {
  return {
    providerCredential: { findFirst: vi.fn().mockResolvedValue(row) },
  } as unknown as CredentialReader;
}

describe('messaging provider factories', () => {
  beforeEach(() => {
    clearCredentialCache();
    (env as { HELIO_ENCRYPTION_KEY?: string }).HELIO_ENCRYPTION_KEY = KEY;
  });

  it('builds a twilio provider from the org credential', async () => {
    const id = 'cred_sms_1';
    const resolve = createSmsResolver(
      readerFor({
        id,
        organizationId: 'org_a',
        kind: 'SMS_TWILIO',
        name: 'Twilio',
        config: { accountSid: 'AC' + 'a'.repeat(32), fromNumber: '+15555550100' },
        secrets: {
          authToken: await encryptField(
            'tw-token',
            { organizationId: 'org_a', credentialId: id, field: 'authToken' },
            KEY,
          ),
        },
        status: 'VERIFIED',
      }),
    );
    expect(await resolve('org_a')).toBeInstanceOf(TwilioSmsProvider);
  });

  it('falls back to the env provider (or nothing) when unconfigured', async () => {
    const fallback = new InMemorySmsProvider();
    expect(await createSmsResolver(readerFor(null), fallback)('org_a')).toBe(fallback);
    expect(await createSmsResolver(readerFor(null))('org_a')).toBeUndefined();
  });

  it('builds a whatsapp cloud provider from the org credential', async () => {
    const id = 'cred_wa_1';
    const resolve = createWhatsAppResolver(
      readerFor({
        id,
        organizationId: 'org_a',
        kind: 'WHATSAPP_CLOUD',
        name: 'WA',
        config: { phoneNumberId: '12345' },
        secrets: {
          accessToken: await encryptField(
            'wa-token',
            { organizationId: 'org_a', credentialId: id, field: 'accessToken' },
            KEY,
          ),
        },
        status: 'VERIFIED',
      }),
    );
    expect(await resolve('org_a')).toBeInstanceOf(CloudWhatsAppProvider);
  });

  it('collapses lookup failures to the fallback', async () => {
    const reader = {
      providerCredential: { findFirst: vi.fn().mockRejectedValue(new Error('pg down')) },
    } as unknown as CredentialReader;
    expect(await createWhatsAppResolver(reader)('org_a')).toBeUndefined();
  });
});
