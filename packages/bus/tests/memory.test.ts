import type { EnrichedEvent } from '@helio/core';
import { describe, expect, it } from 'vitest';

import { InMemoryEventProducer } from '../src/memory';

const event = (id: string): EnrichedEvent => ({
  message_id: id,
  organization_id: 'org',
  workspace_id: 'ws',
  type: 'track',
  event: 'X',
  anonymous_id: '',
  user_id: 'u',
  properties: '{}',
  context: '{}',
  timestamp: new Date().toISOString(),
  received_at: new Date().toISOString(),
});

describe('InMemoryEventProducer', () => {
  it('collects published events in order', async () => {
    const producer = new InMemoryEventProducer();
    await producer.publish([event('1')]);
    await producer.publish([event('2'), event('3')]);
    expect(producer.published.map((entry) => entry.message_id)).toEqual(['1', '2', '3']);
  });

  it('fails exactly once when armed', async () => {
    const producer = new InMemoryEventProducer();
    producer.failNext = true;
    await expect(producer.publish([event('1')])).rejects.toThrowError('bus unavailable');
    await expect(producer.publish([event('2')])).resolves.toBeUndefined();
    expect(producer.published).toHaveLength(1);
  });
});
