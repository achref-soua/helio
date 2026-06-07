import type { EnrichedEvent } from '@helio/core';
import { Kafka, logLevel, type Producer } from 'kafkajs';

import type { EventBusProducer } from './types';

/**
 * Kafka-protocol producer (Redpanda in the default deployment, ADR-0007).
 * Messages are keyed by workspace so each workspace's events stay ordered
 * within a partition.
 */
export class KafkaEventProducer implements EventBusProducer {
  private readonly producer: Producer;

  constructor(
    brokers: string[],
    private readonly topic: string,
    clientId = 'helio-ingest',
  ) {
    const kafka = new Kafka({ clientId, brokers, logLevel: logLevel.NOTHING });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  async publish(events: EnrichedEvent[]): Promise<void> {
    await this.producer.send({
      topic: this.topic,
      messages: events.map((event) => ({
        key: event.workspace_id,
        value: JSON.stringify(event),
      })),
    });
  }
}

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
