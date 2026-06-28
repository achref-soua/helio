import type { PushNotification } from '@helio/core';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryPushProvider, WebPushProvider } from '../src/push-provider';

// web-push is a thin VAPID wrapper around the browser push services; stub it so
// the adapter's own status mapping is what we exercise here.
const { setVapidDetails, sendNotification } = vi.hoisted(() => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock('web-push', () => {
  const mod = { setVapidDetails, sendNotification };
  return { default: mod, ...mod };
});

const notification: PushNotification = {
  title: 'Hi',
  body: 'there',
  url: 'https://app.helio.test',
};
const target = { endpoint: 'https://push.example/abc', p256dh: 'p256', auth: 'auth' };

describe('WebPushProvider', () => {
  const provider = new WebPushProvider({
    publicKey: 'pk',
    privateKey: 'sk',
    subject: 'mailto:ops@helio.test',
  });

  it('configures VAPID on construction', () => {
    new WebPushProvider({ publicKey: 'pk2', privateKey: 'sk2', subject: 'mailto:a@b.test' });
    expect(setVapidDetails).toHaveBeenLastCalledWith('mailto:a@b.test', 'pk2', 'sk2');
  });

  it('returns sent and forwards the subscription + payload', async () => {
    sendNotification.mockResolvedValueOnce({ statusCode: 201 });
    expect(await provider.send(target, notification)).toBe('sent');
    const [subscription, payload] = sendNotification.mock.calls.at(-1)!;
    expect(subscription).toEqual({
      endpoint: target.endpoint,
      keys: { p256dh: 'p256', auth: 'auth' },
    });
    expect(JSON.parse(payload as string)).toEqual(notification);
  });

  it('maps 404 and 410 to gone, and any other failure to failed', async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    expect(await provider.send(target, notification)).toBe('gone');
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    expect(await provider.send(target, notification)).toBe('gone');
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });
    expect(await provider.send(target, notification)).toBe('failed');
    sendNotification.mockRejectedValueOnce(new Error('network down'));
    expect(await provider.send(target, notification)).toBe('failed');
  });
});

describe('InMemoryPushProvider', () => {
  it('records sends and can mark endpoints gone or failing', async () => {
    const provider = new InMemoryPushProvider();
    expect(await provider.send(target, notification)).toBe('sent');
    expect(provider.sent).toEqual([{ target, notification }]);

    provider.gone.add('gone-endpoint');
    expect(await provider.send({ ...target, endpoint: 'gone-endpoint' }, notification)).toBe(
      'gone',
    );

    provider.failing.add('failing-endpoint');
    expect(await provider.send({ ...target, endpoint: 'failing-endpoint' }, notification)).toBe(
      'failed',
    );
  });
});
