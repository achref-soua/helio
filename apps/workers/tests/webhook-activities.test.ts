import { SsrfError } from '@helio/core';
import { describe, expect, it, vi } from 'vitest';

import { createWebhookActivities, type WebhookDeliveryInput } from '../src/webhook-activities';

const base: Omit<WebhookDeliveryInput, 'url'> = {
  endpointId: 'whe_1',
  secret: 'whsec_test_secret_value_1234567890',
  eventId: 'evt_1',
  eventType: 'deal.won',
  occurredAt: '2026-01-01T00:00:00.000Z',
  data: { id: 'deal_1' },
};

const okResponse = { ok: true, status: 200 } as Response;

describe('deliverWebhookEvent SSRF guard', () => {
  it('refuses a private/loopback literal URL before fetching', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    const activities = createWebhookActivities({ fetchImpl, resolve: async () => [] });
    await expect(
      activities.deliverWebhookEvent({ ...base, url: 'http://169.254.169.254/latest/meta-data/' }),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      activities.deliverWebhookEvent({ ...base, url: 'http://127.0.0.1:6379/' }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a hostname that resolves to a private address', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    const activities = createWebhookActivities({
      fetchImpl,
      resolve: async () => ['10.0.0.5'],
    });
    await expect(
      activities.deliverWebhookEvent({ ...base, url: 'https://hook.attacker.example/' }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('delivers to a public address and signs the body', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => okResponse,
    );
    const activities = createWebhookActivities({
      fetchImpl,
      resolve: async () => ['93.184.216.34'],
    });
    await activities.deliverWebhookEvent({ ...base, url: 'https://hooks.example.com/helio' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.com/helio');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers).toMatchObject({ 'x-helio-event': 'deal.won', 'x-helio-delivery': 'evt_1' });
    expect(headers['x-helio-signature']).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
  });

  it('still throws on a non-2xx response (so Temporal retries)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const activities = createWebhookActivities({
      fetchImpl,
      resolve: async () => ['93.184.216.34'],
    });
    await expect(
      activities.deliverWebhookEvent({ ...base, url: 'https://hooks.example.com/helio' }),
    ).rejects.toThrow(/answered 500/);
  });

  it('allowPrivate opts a trusted LAN receiver back in', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    const activities = createWebhookActivities({
      fetchImpl,
      allowPrivate: true,
      resolve: async () => ['10.0.0.5'],
    });
    await activities.deliverWebhookEvent({ ...base, url: 'http://10.0.0.5:8080/hook' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
