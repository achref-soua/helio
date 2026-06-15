import { describe, expect, it } from 'vitest';

import { assertPublicUrl, isBlockedAddress, SsrfError } from '../src/ssrf';

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1', // CGNAT
    '100.100.100.200', // Alibaba metadata (inside CGNAT)
    '127.0.0.1',
    '127.0.0.53',
    '169.254.169.254', // cloud metadata
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.5', // TEST-NET-1
    '192.88.99.1', // 6to4 relay
    '192.168.0.1',
    '192.168.1.1',
    '198.18.0.1', // benchmarking
    '198.51.100.7', // TEST-NET-2
    '203.0.113.9', // TEST-NET-3
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
    '255.255.255.255', // broadcast
  ])('blocks private/reserved IPv4 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.0.1', // just below 172.16/12
    '172.32.0.1', // just above 172.16/12
    '100.63.255.255', // just below CGNAT
    '100.128.0.1', // just above CGNAT
    '169.253.0.1', // adjacent to link-local
    '192.167.0.1', // adjacent to 192.168
    '192.169.0.1',
    '198.20.0.1', // just above benchmarking
  ])('allows public IPv4 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it.each([
    '::1', // loopback
    '::', // unspecified
    'fe80::1', // link-local
    'fc00::1', // unique-local
    'fd12:3456:789a::1', // unique-local
    'ff02::1', // multicast
    '2001:db8::1', // documentation
    '::ffff:127.0.0.1', // v4-mapped loopback
    '::ffff:10.0.0.1', // v4-mapped private
    '::ffff:7f00:1', // v4-mapped loopback (hex form)
    '[::1]', // bracketed
    'fe80::1%eth0', // zone id
  ])('blocks private/reserved IPv6 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '2606:4700:4700::1111', // Cloudflare
    '2001:4860:4860::8888', // Google
    '::ffff:8.8.8.8', // v4-mapped public
  ])('allows public IPv6 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it.each(['example.com', 'redis', 'not-an-ip', ''])('returns false for non-literal %s', (host) => {
    expect(isBlockedAddress(host)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  const reject = (url: string, opts?: Parameters<typeof assertPublicUrl>[1]) =>
    expect(assertPublicUrl(url, opts)).rejects.toBeInstanceOf(SsrfError);
  const allow = (url: string, opts?: Parameters<typeof assertPublicUrl>[1]) =>
    expect(assertPublicUrl(url, opts)).resolves.toBeInstanceOf(URL);

  it('rejects non-http(s) schemes', async () => {
    await reject('file:///etc/passwd');
    await reject('gopher://127.0.0.1:6379/');
    await reject('ftp://example.com/');
    await reject('data:text/html,<script>1</script>');
  });

  it('rejects malformed URLs', async () => {
    await reject('not a url');
    await reject('');
  });

  it('rejects literal private/loopback/metadata hosts', async () => {
    await reject('http://127.0.0.1:6379');
    await reject('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
    await reject('http://10.0.0.5/hook');
    await reject('http://192.168.1.1/');
    await reject('http://[::1]:8080/');
    await reject('http://[fd00::1]/');
  });

  it('rejects decimal/hex IPv4 that URL normalizes to a private address', async () => {
    await reject('http://2130706433/'); // 127.0.0.1
    await reject('http://0x7f000001/'); // 127.0.0.1
  });

  it('rejects internal hostnames without a resolver', async () => {
    await reject('http://localhost/');
    await reject('http://svc.local/');
    await reject('http://api.internal/');
    await reject('http://redis/'); // bare single-label service name
    await reject('http://postgres:5432/');
  });

  it('allows public literal addresses', async () => {
    await allow('http://8.8.8.8/');
    await allow('https://1.1.1.1/');
  });

  it('allows a public dotted hostname best-effort without a resolver', async () => {
    await allow('https://example.com/webhooks/helio');
  });

  it('uses the injected resolver to classify a hostname', async () => {
    await expect(
      assertPublicUrl('https://rebind.evil.test/', { resolve: async () => ['10.0.0.5'] }),
    ).rejects.toBeInstanceOf(SsrfError);
    await allow('https://good.example/', { resolve: async () => ['93.184.216.34'] });
  });

  it('blocks when any resolved address is private', async () => {
    await expect(
      assertPublicUrl('https://mixed.example/', {
        resolve: async () => ['93.184.216.34', '127.0.0.1'],
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('treats resolution failure or empty answers as unsafe', async () => {
    await expect(
      assertPublicUrl('https://nx.example/', {
        resolve: async () => {
          throw new Error('NXDOMAIN');
        },
      }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertPublicUrl('https://empty.example/', { resolve: async () => [] }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('allowPrivate opts out of address classification but keeps the scheme check', async () => {
    await allow('http://127.0.0.1:8000/', { allowPrivate: true });
    await allow('http://localhost/', { allowPrivate: true });
    await reject('file:///etc/passwd', { allowPrivate: true });
  });

  it('requireHttps rejects plain http to a public host', async () => {
    await reject('http://8.8.8.8/', { requireHttps: true });
    await allow('https://8.8.8.8/', { requireHttps: true });
    // allowPrivate bypasses the https requirement (LAN model servers, mirrors Python guard)
    await allow('http://127.0.0.1:8000/', { requireHttps: true, allowPrivate: true });
  });

  it('returns the parsed URL on success', async () => {
    const url = await assertPublicUrl('https://example.com/path?q=1');
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/path');
  });
});
