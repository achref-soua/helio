import { lookup } from 'node:dns/promises';

import {
  assertPublicUrl,
  type CredentialKind,
  probeAllowsPrivateAddress,
  probeOutcome,
  probeRequestFor,
} from '@helio/core';
import nodemailer from 'nodemailer';

/**
 * Execute a credential connectivity probe (descriptors live in
 * @helio/core). Read-only, bounded, and never throws — every failure
 * collapses to a short human message stored on the credential row.
 *
 * The probe URL for a churn endpoint or self-hosted LLM is operator-supplied,
 * so it is SSRF-guarded before the fetch: private/loopback targets are refused
 * unless the kind legitimately runs on localhost/LAN (see
 * `probeAllowsPrivateAddress`). Redirects are not followed, so a 3xx to an
 * internal address can't smuggle the request past the guard.
 */

const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeResult {
  ok: boolean;
  message: string;
}

export interface ProbeOptions {
  /** Mirror INTEL_ALLOW_PRIVATE_MODEL_ENDPOINTS: let a churn probe reach a LAN endpoint. */
  allowPrivateModelEndpoint?: boolean;
  /** Injected in tests; defaults to a `node:dns` lookup. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const dnsResolve = (hostname: string): Promise<string[]> =>
  lookup(hostname, { all: true }).then((records) => records.map((record) => record.address));

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
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolve = options.resolve ?? dnsResolve;
  try {
    if (kind === 'EMAIL_SMTP') return await verifySmtp(config, secrets);
    const probe = probeRequestFor(kind, config, secrets);
    if (!probe) return { ok: false, message: 'This credential kind has no automated check' };
    await assertPublicUrl(probe.url, {
      allowPrivate: probeAllowsPrivateAddress(kind, config, options.allowPrivateModelEndpoint),
      resolve,
    });
    const response = await fetchImpl(probe.url, {
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
