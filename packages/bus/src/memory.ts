import type { EnrichedEvent } from '@helio/core';

import type { EventBusProducer } from './types';

/** Test double: collects published events in memory. */
export class InMemoryEventProducer implements EventBusProducer {
  readonly published: EnrichedEvent[] = [];
  failNext = false;

  publish(events: EnrichedEvent[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('bus unavailable'));
    }
    this.published.push(...events);
    return Promise.resolve();
  }
}
