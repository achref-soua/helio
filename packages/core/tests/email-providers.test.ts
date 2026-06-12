import { describe, expect, it, vi } from 'vitest';

import {
  MailgunEmailProvider,
  type OutgoingEmail,
  PostmarkEmailProvider,
  ResendEmailProvider,
} from '../src/email-providers';

const message: OutgoingEmail = {
  from: 'Acme <hello@acme.test>',
  to: 'ada@example.com',
  subject: 'Hi',
  html: '<p>Hi</p>',
  text: 'Hi',
  headers: { 'List-Unsubscribe': '<http://u.test>' },
};

function fetchReturning(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('PostmarkEmailProvider', () => {
  it('posts the message with the server token and maps the id', async () => {
    const fetchImpl = fetchReturning(200, { MessageID: 'pm-1' });
    const provider = new PostmarkEmailProvider('tok', 'outbound', fetchImpl);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: 'pm-1' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect((init.headers as Record<string, string>)['x-postmark-server-token']).toBe('tok');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.From).toBe(message.from);
    expect(body.MessageStream).toBe('outbound');
    expect(body.Headers).toEqual([{ Name: 'List-Unsubscribe', Value: '<http://u.test>' }]);
  });

  it('throws a readable error on 4xx and 5xx', async () => {
    const unauthorized = new PostmarkEmailProvider('bad', undefined, fetchReturning(401, {}));
    await expect(unauthorized.send(message)).rejects.toThrowError(/postmark answered 401/);
    const down = new PostmarkEmailProvider('tok', undefined, fetchReturning(500, {}));
    await expect(down.send(message)).rejects.toThrowError(/500/);
  });

  it('propagates network failures', async () => {
    const offline = new PostmarkEmailProvider(
      'tok',
      undefined,
      vi.fn().mockRejectedValue(new Error('socket hang up')),
    );
    await expect(offline.send(message)).rejects.toThrowError(/socket hang up/);
  });
});

describe('ResendEmailProvider', () => {
  it('sends with a bearer key and maps the id', async () => {
    const fetchImpl = fetchReturning(200, { id: 're-1' });
    const provider = new ResendEmailProvider('re-key', fetchImpl);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: 're-1' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re-key');
    expect((JSON.parse(String(init.body)) as { to: string[] }).to).toEqual([message.to]);
  });

  it('throws on a rejected key', async () => {
    const provider = new ResendEmailProvider('bad', fetchReturning(403, {}));
    await expect(provider.send(message)).rejects.toThrowError(/resend answered 403/);
  });
});

describe('MailgunEmailProvider', () => {
  it('posts the form to the regioned domain endpoint', async () => {
    const fetchImpl = fetchReturning(200, { id: 'mg-1' });
    const provider = new MailgunEmailProvider(
      { apiKey: 'mg-key', domain: 'mg.acme.test', region: 'eu' },
      fetchImpl,
    );
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: 'mg-1' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.eu.mailgun.net/v3/mg.acme.test/messages');
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Basic /);
    const form = new URLSearchParams(String(init.body));
    expect(form.get('to')).toBe(message.to);
    expect(form.get('h:List-Unsubscribe')).toBe('<http://u.test>');
  });

  it('throws on provider errors', async () => {
    const provider = new MailgunEmailProvider(
      { apiKey: 'k', domain: 'mg.acme.test' },
      fetchReturning(400, { message: 'bad domain' }),
    );
    await expect(provider.send(message)).rejects.toThrowError(/mailgun answered 400/);
  });
});
