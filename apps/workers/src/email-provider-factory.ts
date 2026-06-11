import type { CredentialKind } from '@helio/core';

import { type CredentialReader, resolveOrgCredential } from './credential-store';
import {
  type EmailProvider,
  MailgunEmailProvider,
  PostmarkEmailProvider,
  ResendEmailProvider,
  SmtpEmailProvider,
} from './email-provider';

/**
 * Per-organization email sender resolution. An org that connected an
 * email credential in Settings sends through its own provider with its
 * own From identity; everyone else uses the deployment fallback (env
 * SMTP — Mailpit in dev). Resolution failures never block a send: any
 * problem collapses to the fallback.
 */

export interface ResolvedEmailSender {
  provider: EmailProvider;
  from: string;
  /** True when the org's own credential is being used. */
  viaOrgCredential: boolean;
}

export type EmailSenderResolver = (organizationId: string) => Promise<ResolvedEmailSender>;

const EMAIL_KINDS: CredentialKind[] = [
  'EMAIL_POSTMARK',
  'EMAIL_RESEND',
  'EMAIL_MAILGUN',
  'EMAIL_SMTP',
];

function formatFrom(config: Record<string, unknown>, fallback: string): string {
  const email = typeof config.fromEmail === 'string' ? config.fromEmail : null;
  if (!email) return fallback;
  const name = typeof config.fromName === 'string' ? config.fromName : null;
  return name ? `${name} <${email}>` : email;
}

export function createEmailSenderResolver(
  db: CredentialReader,
  fallback: { provider: EmailProvider; from: string },
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>,
): EmailSenderResolver {
  const fallbackSender: ResolvedEmailSender = { ...fallback, viaOrgCredential: false };

  return async (organizationId) => {
    let credential;
    try {
      credential = await resolveOrgCredential(db, organizationId, EMAIL_KINDS);
    } catch {
      return fallbackSender;
    }
    if (!credential) return fallbackSender;

    const from = formatFrom(credential.config, fallback.from);
    switch (credential.kind) {
      case 'EMAIL_POSTMARK':
        return {
          provider: new PostmarkEmailProvider(
            credential.secrets.serverToken ?? '',
            typeof credential.config.messageStream === 'string'
              ? credential.config.messageStream
              : undefined,
            fetchImpl,
          ),
          from,
          viaOrgCredential: true,
        };
      case 'EMAIL_RESEND':
        return {
          provider: new ResendEmailProvider(credential.secrets.apiKey ?? '', fetchImpl),
          from,
          viaOrgCredential: true,
        };
      case 'EMAIL_MAILGUN':
        return {
          provider: new MailgunEmailProvider(
            {
              apiKey: credential.secrets.apiKey ?? '',
              domain: String(credential.config.domain ?? ''),
              region: credential.config.region === 'eu' ? 'eu' : 'us',
            },
            fetchImpl,
          ),
          from,
          viaOrgCredential: true,
        };
      case 'EMAIL_SMTP':
        return {
          provider: new SmtpEmailProvider({
            host: String(credential.config.host ?? ''),
            port: Number(credential.config.port ?? 0),
            secure: Boolean(credential.config.secure),
            user: typeof credential.config.user === 'string' ? credential.config.user : undefined,
            password: credential.secrets.password,
          }),
          from,
          viaOrgCredential: true,
        };
      default:
        return fallbackSender;
    }
  };
}
