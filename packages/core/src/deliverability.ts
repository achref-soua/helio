/** A DNS record the operator must publish for a sending domain. */
export interface DnsRecord {
  /** Human label (SPF / DKIM / DMARC). */
  label: 'SPF' | 'DKIM' | 'DMARC';
  /** Host / name to create. */
  host: string;
  type: 'TXT';
  value: string;
}

export interface RecordOptions {
  domain: string;
  dkimSelector: string;
  /** Base64 DER of the DKIM public key (no PEM armor). */
  dkimPublicKey: string;
  /** SPF include for the sending provider, e.g. `amazonses.com`. */
  spfInclude?: string | null;
  /** Mailbox for DMARC aggregate reports; defaults to dmarc@domain. */
  dmarcReportTo?: string | null;
}

/** The SPF, DKIM, and DMARC records to publish for a domain. */
export function deliverabilityRecords(options: RecordOptions): DnsRecord[] {
  const include = options.spfInclude ? `include:${options.spfInclude} ` : '';
  const rua = options.dmarcReportTo ?? `dmarc@${options.domain}`;
  return [
    {
      label: 'SPF',
      host: options.domain,
      type: 'TXT',
      value: `v=spf1 ${include}~all`,
    },
    {
      label: 'DKIM',
      host: `${options.dkimSelector}._domainkey.${options.domain}`,
      type: 'TXT',
      value: `v=DKIM1; k=rsa; p=${options.dkimPublicKey}`,
    },
    {
      label: 'DMARC',
      host: `_dmarc.${options.domain}`,
      type: 'TXT',
      value: `v=DMARC1; p=none; rua=mailto:${rua}`,
    },
  ];
}

/** A published SPF policy exists. */
export function spfPasses(txtRecords: readonly string[]): boolean {
  return txtRecords.some((record) => /v=spf1\b/i.test(record));
}

/**
 * The SPF include to suggest for a connected email credential kind, or
 * null when it depends on the relay (plain SMTP) or the kind isn't an
 * email provider.
 */
export function suggestedSpfInclude(kind: string): string | null {
  switch (kind) {
    case 'EMAIL_POSTMARK':
      return 'spf.mtasv.net';
    case 'EMAIL_RESEND':
      return '_spf.resend.com';
    case 'EMAIL_MAILGUN':
      return 'mailgun.org';
    default:
      return null;
  }
}

/** The DKIM record is published and carries the expected public key. */
export function dkimPasses(txtRecords: readonly string[], publicKey: string): boolean {
  return txtRecords.some((record) => /v=DKIM1/i.test(record) && record.includes(publicKey));
}

/** A published DMARC policy exists. */
export function dmarcPasses(txtRecords: readonly string[]): boolean {
  return txtRecords.some((record) => /v=DMARC1\b/i.test(record));
}

/** A loose check that a string looks like a registrable domain. */
export function isLikelyDomain(value: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(value);
}
