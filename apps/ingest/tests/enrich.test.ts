import { describe, expect, it } from 'vitest';

import { enrichEvent } from '../src/enrich';

const scope = { organizationId: 'org_1', workspaceId: 'ws_1' };
const receivedAt = new Date('2026-06-08T10:00:00.000Z');

describe('enrichEvent', () => {
  it('flattens a track event and stamps tenancy + server time', () => {
    const row = enrichEvent(
      {
        type: 'track',
        event: 'Signed Up',
        anonymousId: 'anon-1',
        userId: 'user-1',
        messageId: 'msg-fixed',
        timestamp: '2026-06-08T09:59:58.000Z',
        properties: { plan: 'pro' },
        context: { locale: 'en-US' },
      },
      scope,
      receivedAt,
    );
    expect(row).toEqual({
      message_id: 'msg-fixed',
      organization_id: 'org_1',
      workspace_id: 'ws_1',
      type: 'track',
      event: 'Signed Up',
      anonymous_id: 'anon-1',
      user_id: 'user-1',
      properties: '{"plan":"pro"}',
      context: '{"locale":"en-US"}',
      timestamp: '2026-06-08T09:59:58.000Z',
      received_at: '2026-06-08T10:00:00.000Z',
    });
  });

  it('generates a message id and defaults timestamp to received_at', () => {
    const row = enrichEvent({ type: 'track', event: 'Bare', anonymousId: 'a' }, scope, receivedAt);
    expect(row.message_id).toMatch(/^msg_[0-9a-z]{26}$/);
    expect(row.timestamp).toBe(receivedAt.toISOString());
    expect(row.properties).toBe('{}');
    expect(row.context).toBe('{}');
  });

  it('maps identify traits into the payload column and leaves event empty', () => {
    const row = enrichEvent(
      { type: 'identify', userId: 'u1', traits: { plan: 'pro' } },
      scope,
      receivedAt,
    );
    expect(row.event).toBe('');
    expect(row.properties).toBe('{"plan":"pro"}');
  });

  it('uses the page name as the event for page events', () => {
    const named = enrichEvent(
      { type: 'page', name: 'Pricing', anonymousId: 'a' },
      scope,
      receivedAt,
    );
    expect(named.event).toBe('Pricing');
    const unnamed = enrichEvent({ type: 'page', anonymousId: 'a' }, scope, receivedAt);
    expect(unnamed.event).toBe('');
  });
});
