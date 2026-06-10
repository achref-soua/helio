import { describe, expect, it } from 'vitest';

import {
  deliverabilityRecords,
  dkimPasses,
  dmarcPasses,
  isLikelyDomain,
  spfPasses,
} from '../src/deliverability';

describe('deliverabilityRecords', () => {
  it('builds SPF, DKIM, and DMARC records for a domain', () => {
    const records = deliverabilityRecords({
      domain: 'mail.acme.com',
      dkimSelector: 'helio',
      dkimPublicKey: 'PUBKEY',
      spfInclude: 'amazonses.com',
    });
    expect(records.map((r) => r.label)).toEqual(['SPF', 'DKIM', 'DMARC']);
    expect(records[0]!.value).toBe('v=spf1 include:amazonses.com ~all');
    expect(records[1]!.host).toBe('helio._domainkey.mail.acme.com');
    expect(records[1]!.value).toBe('v=DKIM1; k=rsa; p=PUBKEY');
    expect(records[2]!.host).toBe('_dmarc.mail.acme.com');
    expect(records[2]!.value).toContain('rua=mailto:dmarc@mail.acme.com');
  });

  it('omits the SPF include when no provider is given', () => {
    const [spf] = deliverabilityRecords({
      domain: 'acme.com',
      dkimSelector: 'helio',
      dkimPublicKey: 'K',
    });
    expect(spf!.value).toBe('v=spf1 ~all');
  });
});

describe('record checkers', () => {
  it('detect published SPF / DKIM / DMARC records', () => {
    expect(spfPasses(['v=spf1 include:x ~all'])).toBe(true);
    expect(spfPasses(['unrelated'])).toBe(false);
    expect(dkimPasses(['v=DKIM1; k=rsa; p=PUBKEY'], 'PUBKEY')).toBe(true);
    expect(dkimPasses(['v=DKIM1; k=rsa; p=OTHER'], 'PUBKEY')).toBe(false);
    expect(dmarcPasses(['v=DMARC1; p=none'])).toBe(true);
    expect(dmarcPasses(['v=spf1 ~all'])).toBe(false);
  });
});

describe('isLikelyDomain', () => {
  it('accepts domains and rejects junk', () => {
    expect(isLikelyDomain('acme.com')).toBe(true);
    expect(isLikelyDomain('mail.acme.co.uk')).toBe(true);
    expect(isLikelyDomain('localhost')).toBe(false);
    expect(isLikelyDomain('no spaces.com')).toBe(false);
    expect(isLikelyDomain('-bad.com')).toBe(false);
  });
});
