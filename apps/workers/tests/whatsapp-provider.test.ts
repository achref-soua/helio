import { afterEach, describe, expect, it, vi } from 'vitest';

import { CloudWhatsAppProvider, InMemoryWhatsAppProvider } from '../src/whatsapp-provider';

describe('CloudWhatsAppProvider', () => {
  const provider = new CloudWhatsAppProvider({ phoneNumberId: '123', accessToken: 'tok' });

  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(impl: () => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(impl));
  }

  it('POSTs a text message to the Graph API with a bearer token', async () => {
    stubFetch(async () => new Response('{}', { status: 200 }));
    expect(await provider.send('+15555551234', 'hi')).toBe('sent');
    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toContain('/123/messages');
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '+15555551234',
      type: 'text',
      text: { body: 'hi' },
    });
  });

  it('maps 400 to invalid, other statuses and network errors to failed', async () => {
    stubFetch(async () => new Response('bad', { status: 400 }));
    expect(await provider.send('+1', 'hi')).toBe('invalid');
    stubFetch(async () => new Response('boom', { status: 500 }));
    expect(await provider.send('+1', 'hi')).toBe('failed');
    stubFetch(async () => {
      throw new Error('network down');
    });
    expect(await provider.send('+1', 'hi')).toBe('failed');
  });
});

describe('InMemoryWhatsAppProvider', () => {
  it('records sends and can mark numbers failing', async () => {
    const provider = new InMemoryWhatsAppProvider();
    expect(await provider.send('+15555551234', 'hello')).toBe('sent');
    expect(provider.sent).toEqual([{ to: '+15555551234', body: 'hello' }]);
    provider.failing.add('+15555559999');
    expect(await provider.send('+15555559999', 'x')).toBe('failed');
  });
});
