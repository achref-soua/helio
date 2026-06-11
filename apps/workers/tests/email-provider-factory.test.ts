import { encryptField, generateEncryptionKey } from '@helio/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = generateEncryptionKey();

vi.mock('../src/env', () => ({ env: { HELIO_ENCRYPTION_KEY: '' } }));

import { clearCredentialCache, type CredentialReader } from '../src/credential-store';
import {
  InMemoryEmailProvider,
  MailgunEmailProvider,
  PostmarkEmailProvider,
  ResendEmailProvider,
  SmtpEmailProvider,
} from '../src/email-provider';
import { createEmailSenderResolver } from '../src/email-provider-factory';
import { env } from '../src/env';

const fallbackProvider = new InMemoryEmailProvider();
const fallback = { provider: fallbackProvider, from: 'Helio <no-reply@helio.local>' };

function readerFor(row: unknown): CredentialReader {
  return {
    providerCredential: { findFirst: vi.fn().mockResolvedValue(row) },
  } as unknown as CredentialReader;
}

async function postmarkRow(orgId: string) {
  const id = 'cred_email_1';
  return {
    id,
    organizationId: orgId,
    kind: 'EMAIL_POSTMARK',
    name: 'Prod',
    config: { fromEmail: 'news@acme.test', fromName: 'Acme News' },
    secrets: {
      serverToken: await encryptField(
        'pm-token',
        { organizationId: orgId, credentialId: id, field: 'serverToken' },
        KEY,
      ),
    },
    status: 'VERIFIED',
  };
}

describe('createEmailSenderResolver', () => {
  beforeEach(() => {
    clearCredentialCache();
    (env as { HELIO_ENCRYPTION_KEY?: string }).HELIO_ENCRYPTION_KEY = KEY;
  });

  it('builds the org adapter with the org From identity', async () => {
    const resolve = createEmailSenderResolver(readerFor(await postmarkRow('org_a')), fallback);
    const sender = await resolve('org_a');
    expect(sender.viaOrgCredential).toBe(true);
    expect(sender.from).toBe('Acme News <news@acme.test>');
    expect(sender.provider).toBeInstanceOf(PostmarkEmailProvider);
  });

  it('falls back to the deployment sender when nothing is configured', async () => {
    const resolve = createEmailSenderResolver(readerFor(null), fallback);
    const sender = await resolve('org_a');
    expect(sender.viaOrgCredential).toBe(false);
    expect(sender.provider).toBe(fallbackProvider);
    expect(sender.from).toBe(fallback.from);
  });

  it('builds each remaining adapter kind from its credential row', async () => {
    const seal = (orgId: string, id: string, field: string, value: string) =>
      encryptField(value, { organizationId: orgId, credentialId: id, field }, KEY);

    const resend = createEmailSenderResolver(
      readerFor({
        id: 'cred_re',
        organizationId: 'org_re',
        kind: 'EMAIL_RESEND',
        name: 'Resend',
        config: { fromEmail: 'r@acme.test' },
        secrets: { apiKey: await seal('org_re', 'cred_re', 'apiKey', 're-key') },
        status: 'VERIFIED',
      }),
      fallback,
    );
    const resendSender = await resend('org_re');
    expect(resendSender.provider).toBeInstanceOf(ResendEmailProvider);
    // No fromName configured → bare address.
    expect(resendSender.from).toBe('r@acme.test');

    clearCredentialCache();
    const mailgun = createEmailSenderResolver(
      readerFor({
        id: 'cred_mg',
        organizationId: 'org_mg',
        kind: 'EMAIL_MAILGUN',
        name: 'Mailgun',
        config: { domain: 'mg.acme.test', fromEmail: 'm@acme.test' },
        secrets: { apiKey: await seal('org_mg', 'cred_mg', 'apiKey', 'mg-key') },
        status: 'UNVERIFIED',
      }),
      fallback,
    );
    expect((await mailgun('org_mg')).provider).toBeInstanceOf(MailgunEmailProvider);

    clearCredentialCache();
    const smtp = createEmailSenderResolver(
      readerFor({
        id: 'cred_smtp',
        organizationId: 'org_smtp',
        kind: 'EMAIL_SMTP',
        name: 'Relay',
        config: { host: 'smtp.acme.test', port: 587, secure: false, user: 'mailer' },
        secrets: { password: await seal('org_smtp', 'cred_smtp', 'password', 'relay-pass') },
        status: 'VERIFIED',
      }),
      fallback,
    );
    const smtpSender = await smtp('org_smtp');
    expect(smtpSender.provider).toBeInstanceOf(SmtpEmailProvider);
    // No fromEmail in config → the deployment From stays.
    expect(smtpSender.from).toBe(fallback.from);
  });

  it('falls back when the credential lookup itself throws', async () => {
    const reader = {
      providerCredential: { findFirst: vi.fn().mockRejectedValue(new Error('pg down')) },
    } as unknown as CredentialReader;
    const sender = await createEmailSenderResolver(reader, fallback)('org_x');
    expect(sender.provider).toBe(fallbackProvider);
  });

  it('falls back when the vault key cannot open the credential', async () => {
    const resolve = createEmailSenderResolver(readerFor(await postmarkRow('org_a')), fallback);
    (env as { HELIO_ENCRYPTION_KEY?: string }).HELIO_ENCRYPTION_KEY = generateEncryptionKey();
    const sender = await resolve('org_a');
    expect(sender.viaOrgCredential).toBe(false);
    expect(sender.provider).toBe(fallbackProvider);
  });
});
