import { type CredentialReader, resolveOrgCredential } from './credential-store';
import { type SmsProvider, TwilioSmsProvider } from './sms-provider';
import { CloudWhatsAppProvider, type WhatsAppProvider } from './whatsapp-provider';

/**
 * Per-organization SMS/WhatsApp resolution, mirroring the email factory:
 * an org with a connected credential messages through its own account
 * and number; otherwise the deployment-env provider (if configured)
 * handles it; with neither, the node no-ops as before. Failures always
 * collapse to the fallback.
 */

export type SmsResolver = (organizationId: string) => Promise<SmsProvider | undefined>;
export type WhatsAppResolver = (organizationId: string) => Promise<WhatsAppProvider | undefined>;

export function createSmsResolver(db: CredentialReader, fallback?: SmsProvider): SmsResolver {
  return async (organizationId) => {
    try {
      const credential = await resolveOrgCredential(db, organizationId, ['SMS_TWILIO']);
      if (credential?.secrets.authToken) {
        return new TwilioSmsProvider({
          accountSid: String(credential.config.accountSid ?? ''),
          authToken: credential.secrets.authToken,
          from: String(credential.config.fromNumber ?? ''),
        });
      }
    } catch {
      // fall back
    }
    return fallback;
  };
}

export function createWhatsAppResolver(
  db: CredentialReader,
  fallback?: WhatsAppProvider,
): WhatsAppResolver {
  return async (organizationId) => {
    try {
      const credential = await resolveOrgCredential(db, organizationId, ['WHATSAPP_CLOUD']);
      if (credential?.secrets.accessToken) {
        return new CloudWhatsAppProvider({
          phoneNumberId: String(credential.config.phoneNumberId ?? ''),
          accessToken: credential.secrets.accessToken,
        });
      }
    } catch {
      // fall back
    }
    return fallback;
  };
}
