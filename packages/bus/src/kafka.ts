import type { EnrichedEvent } from '@helio/core';
import { Kafka, logLevel, type Producer } from 'kafkajs';

import type { EventBusProducer } from './types';

/**
 * Kafka-protocol producer. Messages are keyed by workspace so each
 * workspace's events stay ordered within a partition.
 */
export class KafkaEventProducer implements EventBusProducer {
  private readonly producer: Producer;

  constructor(
    brokers: string[],
    private readonly topic: string,
    clientId: string,
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
