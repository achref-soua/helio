import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemorySmsProvider, TwilioSmsProvider } from '../src/sms-provider';

describe('TwilioSmsProvider', () => {
  const provider = new TwilioSmsProvider({
    accountSid: 'AC1',
    authToken: 'tok',
    from: '+15555550100',
  });

  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(impl: () => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  it('POSTs to the Messages endpoint with basic auth and returns sent on 2xx', async () => {
    stubFetch(async () => new Response('{}', { status: 201 }));
    expect(await provider.send('+15555551234', 'hi')).toBe('sent');
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toContain('/Accounts/AC1/Messages.json');
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(((call[1] as RequestInit).headers as Record<string, string>).authorization).toMatch(
      /^Basic /,
    );
  });

  it('maps 400 to invalid, other statuses and network errors to failed', async () => {
    stubFetch(async () => new Response('bad number', { status: 400 }));
    expect(await provider.send('+1', 'hi')).toBe('invalid');
    stubFetch(async () => new Response('boom', { status: 500 }));
    expect(await provider.send('+1', 'hi')).toBe('failed');
    stubFetch(async () => {
      throw new Error('network down');
    });
    expect(await provider.send('+1', 'hi')).toBe('failed');
  });
});

describe('InMemorySmsProvider', () => {
  it('records sends and can mark numbers failing', async () => {
    const provider = new InMemorySmsProvider();
    expect(await provider.send('+15555551234', 'hello')).toBe('sent');
    expect(provider.sent).toEqual([{ to: '+15555551234', body: 'hello' }]);
    provider.failing.add('+15555559999');
    expect(await provider.send('+15555559999', 'x')).toBe('failed');
  });
});
