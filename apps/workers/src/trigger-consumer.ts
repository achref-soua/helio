import { type EnrichedEvent } from '@helio/core';
import { Kafka, logLevel } from 'kafkajs';

import { enrollFromEvent, scoreFromEvent, type TriggerDeps } from './journey-triggers';

export interface TriggerConsumerOptions {
  brokers: string[];
  topic: string;
  groupId?: string;
}

/** Kafka consumer feeding enrollFromEvent. Separate group from the CH sink. */
export class JourneyTriggerConsumer {
  private readonly consumer;

  constructor(
    private readonly deps: TriggerDeps,
    options: TriggerConsumerOptions,
  ) {
    const kafka = new Kafka({
      clientId: 'helio-journey-triggers',
      brokers: options.brokers,
      logLevel: logLevel.NOTHING,
    });
    this.consumer = kafka.consumer({ groupId: options.groupId ?? 'journey-triggers' });
    this.topic = options.topic;
  }

  private readonly topic: string;

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        let event: EnrichedEvent;
        try {
          event = JSON.parse(message.value.toString()) as EnrichedEvent;
        } catch {
          return; // poison message — the sink logs these already
        }
        try {
          await scoreFromEvent(event, this.deps);
          await enrollFromEvent(event, this.deps);
        } catch (error) {
          // Enrollment is best-effort per event; failures must not stall
          // the partition. The run row records anything half-started.
          this.deps.logger.error({ error, event: event.event }, 'trigger enrollment failed');
        }
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
