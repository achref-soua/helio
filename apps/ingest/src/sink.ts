import type { ClickHouseClient } from '@clickhouse/client';
import type { EnrichedEvent } from '@helio/core';
import { Kafka, logLevel } from 'kafkajs';
import type { Logger } from 'pino';

import { sinkInsertFailures, sinkRowsInserted } from './observability';

export interface SinkOptions {
  brokers: string[];
  topic: string;
  groupId?: string;
  clientId?: string;
}

/**
 * Bus → ClickHouse sink. Consumes the events topic in batches and inserts
 * rows with a single JSONEachRow request per poll. Offsets commit only
 * after a successful insert (eachBatchAutoResolve), so failures redeliver:
 * at-least-once end to end, deduplicated by the table engine.
 */
export class ClickHouseSink {
  private readonly consumer;

  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly logger: Logger,
    options: SinkOptions,
  ) {
    const kafka = new Kafka({
      clientId: options.clientId ?? 'helio-ingest-sink',
      brokers: options.brokers,
      logLevel: logLevel.NOTHING,
    });
    this.consumer = kafka.consumer({ groupId: options.groupId ?? 'clickhouse-sink' });
    this.topic = options.topic;
  }

  private readonly topic: string;

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.topic, fromBeginning: true });
    await this.consumer.run({
      eachBatch: async ({ batch, heartbeat }) => {
        const rows: EnrichedEvent[] = [];
        for (const message of batch.messages) {
          if (!message.value) continue;
          try {
            rows.push(JSON.parse(message.value.toString()) as EnrichedEvent);
          } catch (error) {
            // Poison message: log and drop — replaying it forever helps nobody.
            this.logger.error({ error, offset: message.offset }, 'sink: unparseable message');
          }
        }
        if (rows.length === 0) return;
        try {
          await this.clickhouse.insert({ table: 'events', values: rows, format: 'JSONEachRow' });
          sinkRowsInserted.inc(rows.length);
        } catch (error) {
          sinkInsertFailures.inc();
          this.logger.error({ error, rows: rows.length }, 'sink: insert failed, will redeliver');
          throw error;
        }
        await heartbeat();
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
