import { clickRedirectUrl, signClickTarget, verifyClickTarget } from '@helio/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { InMemoryEventProducer } from '../src/bus';
import type { ResolvedSend, SendResolver } from '../src/types';

const SECRET = 'tracking-secret-for-tests-0001';
const SEND: ResolvedSend = {
  organizationId: 'org_1',
  workspaceId: 'ws_1',
  contactId: 'contact_1',
  email: 'ada@example.com',
  campaignId: 'cmp_1',
};

const resolver: SendResolver = {
  resolve: (sendId) => Promise.resolve(sendId === 'snd_known' ? SEND : null),
};

describe('tracking app', () => {
  let app: ReturnType<typeof createApp>;
  let producer: InMemoryEventProducer;

  beforeEach(() => {
    producer = new InMemoryEventProducer();
    app = createApp({
      sends: resolver,
      producer,
      secret: SECRET,
      now: () => new Date('2026-06-08T12:00:00.000Z'),
    });
  });

  describe('open pixel', () => {
    it('serves the gif and publishes Email Opened', async () => {
      const response = await app.request('/o/snd_known.gif');
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/gif');
      expect(response.headers.get('cache-control')).toContain('no-store');

      expect(producer.published).toHaveLength(1);
      expect(producer.published[0]).toMatchObject({
        type: 'track',
        event: 'Email Opened',
        organization_id: 'org_1',
        workspace_id: 'ws_1',
        user_id: 'ada@example.com',
        received_at: '2026-06-08T12:00:00.000Z',
      });
      expect(JSON.parse(producer.published[0]!.properties)).toMatchObject({
        sendId: 'snd_known',
        campaignId: 'cmp_1',
      });
    });

    it('still serves the gif for unknown sends without publishing', async () => {
      const response = await app.request('/o/snd_unknown.gif');
      expect(response.status).toBe(200);
      expect(producer.published).toHaveLength(0);
    });

    it('serves the gif even when the bus is down (never breaks rendering)', async () => {
      producer.failNext = true;
      const response = await app.request('/o/snd_known.gif');
      expect(response.status).toBe(200);
    });
  });

  describe('click redirector', () => {
    const TARGET = 'https://example.com/landing?utm=email';

    it('redirects with a valid signature and publishes Email Link Clicked', async () => {
      const url = await clickRedirectUrl('http://t.local', SECRET, 'snd_known', TARGET);
      const response = await app.request(url.replace('http://t.local', ''));
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(TARGET);

      expect(producer.published).toHaveLength(1);
      expect(producer.published[0]).toMatchObject({ event: 'Email Link Clicked' });
      expect(JSON.parse(producer.published[0]!.properties)).toMatchObject({ url: TARGET });
    });

    it('refuses tampered targets — not an open redirect', async () => {
      const signature = await signClickTarget(SECRET, 'snd_known', TARGET);
      const evil = `/c/snd_known?u=${encodeURIComponent('https://evil.example')}&s=${signature}`;
      const response = await app.request(evil);
      expect(response.status).toBe(400);
      expect(producer.published).toHaveLength(0);
    });

    it('refuses signatures minted for another send id', async () => {
      const signature = await signClickTarget(SECRET, 'snd_other', TARGET);
      const response = await app.request(
        `/c/snd_known?u=${encodeURIComponent(TARGET)}&s=${signature}`,
      );
      expect(response.status).toBe(400);
    });

    it('requires both query parameters', async () => {
      expect((await app.request('/c/snd_known')).status).toBe(400);
      expect((await app.request(`/c/snd_known?u=${encodeURIComponent(TARGET)}`)).status).toBe(400);
    });

    it('redirects (without an event) when the send is unknown but the signature is valid', async () => {
      const url = await clickRedirectUrl('http://t.local', SECRET, 'snd_unknown', TARGET);
      const response = await app.request(url.replace('http://t.local', ''));
      expect(response.status).toBe(302);
      expect(producer.published).toHaveLength(0);
    });
  });

  it('verifyClickTarget round-trips and rejects bad input', async () => {
    const signature = await signClickTarget(SECRET, 'snd_1', 'https://x.test');
    expect(await verifyClickTarget(SECRET, 'snd_1', 'https://x.test', signature)).toBe(true);
    expect(await verifyClickTarget(SECRET, 'snd_1', 'https://y.test', signature)).toBe(false);
    expect(await verifyClickTarget(SECRET, 'snd_1', 'https://x.test', 'short')).toBe(false);
    expect(
      await verifyClickTarget('other-secret-other-secret', 'snd_1', 'https://x.test', signature),
    ).toBe(false);
  });

  it('healthz and readyz respond', async () => {
    expect((await app.request('/healthz')).status).toBe(200);
    expect((await app.request('/readyz')).status).toBe(200);
  });
});
