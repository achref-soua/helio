import { type CredentialKind, probeOutcome, probeRequestFor } from '@helio/core';
import nodemailer from 'nodemailer';

/**
 * Execute a credential connectivity probe (descriptors live in
 * @helio/core). Read-only, bounded, and never throws — every failure
 * collapses to a short human message stored on the credential row.
 */

const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeResult {
  ok: boolean;
  message: string;
}

async function verifySmtp(
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<ProbeResult> {
  const transport = nodemailer.createTransport({
    host: String(config.host ?? ''),
    port: Number(config.port ?? 0),
    secure: Boolean(config.secure),
    ...(config.user ? { auth: { user: String(config.user), pass: secrets.password ?? '' } } : {}),
    connectionTimeout: PROBE_TIMEOUT_MS,
    greetingTimeout: PROBE_TIMEOUT_MS,
    socketTimeout: PROBE_TIMEOUT_MS,
  });
  try {
    await transport.verify();
    return { ok: true, message: 'SMTP connection verified' };
  } finally {
    transport.close();
  }
}

export async function runCredentialProbe(
  kind: CredentialKind,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): Promise<ProbeResult> {
  try {
    if (kind === 'EMAIL_SMTP') return await verifySmtp(config, secrets);
    const probe = probeRequestFor(kind, config, secrets);
    if (!probe) return { ok: false, message: 'This credential kind has no automated check' };
    const response = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return probeOutcome(kind, response.status);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : 'connection failed';
    return { ok: false, message };
  }
}
