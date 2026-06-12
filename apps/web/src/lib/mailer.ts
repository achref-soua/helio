import {
  type CredentialKind,
  credentialSpec,
  decryptField,
  type EmailProvider,
  MailgunEmailProvider,
  type OutgoingEmail,
  PostmarkEmailProvider,
  ResendEmailProvider,
} from '@helio/core';
import { forTenant } from '@helio/db';
import nodemailer from 'nodemailer';

import { appDb } from './db';
import { env } from './env';

/**
 * System mail (verification, password reset, invitations, test sends).
 * When the caller knows the organization, the org's own email credential
 * sends it — so an invite carries the org's From identity; otherwise, or
 * on any resolution failure, the deployment fallback SMTP delivers it
 * (Mailpit in dev, so nothing real leaves the machine).
 */

const EMAIL_KINDS: CredentialKind[] = [
  'EMAIL_POSTMARK',
  'EMAIL_RESEND',
  'EMAIL_MAILGUN',
  'EMAIL_SMTP',
];

const fallbackTransport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface CredentialRowForSend {
  id: string;
  kind: string;
  config: unknown;
  secrets: unknown;
}

export interface OrgSender {
  from: string;
  send(message: Omit<OutgoingEmail, 'from'>): Promise<void>;
}

/**
 * Build a sender from a credential row, decrypting its secrets. Shared by
 * system mail and the settings test-send. Throws on unreadable secrets —
 * callers decide whether to fall back or surface the error.
 */
export async function senderFromCredentialRow(
  organizationId: string,
  row: CredentialRowForSend,
): Promise<OrgSender> {
  const key = env.HELIO_ENCRYPTION_KEY;
  if (!key) throw new Error('HELIO_ENCRYPTION_KEY is not configured');

  const kind = row.kind as CredentialKind;
  const config = (row.config ?? {}) as Record<string, unknown>;
  const stored = (row.secrets ?? {}) as Record<string, string>;
  const secrets: Record<string, string> = {};
  for (const field of credentialSpec(kind).secretFields) {
    const envelope = stored[field.name];
    if (!envelope) continue;
    secrets[field.name] = await decryptField(
      envelope,
      { organizationId, credentialId: row.id, field: field.name },
      key,
      env.HELIO_ENCRYPTION_KEY_PREVIOUS,
    );
  }

  const email = typeof config.fromEmail === 'string' ? config.fromEmail : null;
  const name = typeof config.fromName === 'string' ? config.fromName : null;
  const from = email ? (name ? `${name} <${email}>` : email) : env.MAIL_FROM;

  let provider: EmailProvider;
  switch (kind) {
    case 'EMAIL_POSTMARK':
      provider = new PostmarkEmailProvider(
        secrets.serverToken ?? '',
        typeof config.messageStream === 'string' ? config.messageStream : undefined,
      );
      break;
    case 'EMAIL_RESEND':
      provider = new ResendEmailProvider(secrets.apiKey ?? '');
      break;
    case 'EMAIL_MAILGUN':
      provider = new MailgunEmailProvider({
        apiKey: secrets.apiKey ?? '',
        domain: String(config.domain ?? ''),
        region: config.region === 'eu' ? 'eu' : 'us',
      });
      break;
    case 'EMAIL_SMTP': {
      const transport = nodemailer.createTransport({
        host: String(config.host ?? ''),
        port: Number(config.port ?? 0),
        secure: Boolean(config.secure),
        auth:
          typeof config.user === 'string'
            ? { user: config.user, pass: secrets.password ?? '' }
            : undefined,
      });
      provider = {
        async send(message) {
          const info = await transport.sendMail(message);
          return { providerMessageId: String(info.messageId) };
        },
      };
      break;
    }
    default:
      throw new Error(`${kind} is not an email credential`);
  }

  return {
    from,
    send: async (message) => {
      await provider.send({ from, ...message });
    },
  };
}

export async function sendMail(options: {
  to: string;
  subject: string;
  text: string;
  organizationId?: string;
}) {
  const { organizationId, ...message } = options;
  const html = `<p>${escapeHtml(message.text).replaceAll('\n', '<br/>')}</p>`;

  if (organizationId && env.HELIO_ENCRYPTION_KEY) {
    try {
      const row = await forTenant(appDb, organizationId).providerCredential.findFirst({
        where: { kind: { in: EMAIL_KINDS } },
        orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
        select: { id: true, kind: true, config: true, secrets: true },
      });
      if (row) {
        const sender = await senderFromCredentialRow(organizationId, row);
        await sender.send({ ...message, html });
        return;
      }
    } catch {
      // Fall through: system mail must always go out.
    }
  }
  await fallbackTransport.sendMail({ from: env.MAIL_FROM, ...message, html });
}
