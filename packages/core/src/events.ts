import { z } from 'zod';

/**
 * The wire contract between the tracking SDK and the ingestion service.
 * Shapes follow the Segment-style spec (track / identify / page) so
 * existing instrumentation habits transfer directly.
 */

const isoTimestampSchema = z.iso.datetime({ offset: true });

/** Free-form JSON payloads, size-capped at the HTTP layer. */
const jsonRecordSchema = z.record(z.string(), z.unknown());

const contextSchema = z
  .object({
    page: z
      .object({
        url: z.string().max(2048).optional(),
        path: z.string().max(2048).optional(),
        title: z.string().max(512).optional(),
        referrer: z.string().max(2048).optional(),
      })
      .optional(),
    locale: z.string().max(35).optional(),
    timezone: z.string().max(64).optional(),
    userAgent: z.string().max(512).optional(),
    library: z.object({ name: z.string().max(64), version: z.string().max(32) }).optional(),
  })
  .optional();

const baseEventFields = {
  /** Client-generated unique id; the pipeline dedupes on it. */
  messageId: z.string().max(64).optional(),
  anonymousId: z.string().min(1).max(64).optional(),
  /** The integrator's stable user identifier (their user id, not ours). */
  userId: z.string().min(1).max(128).optional(),
  /** Client event time; the server records receivedAt separately. */
  timestamp: isoTimestampSchema.optional(),
  context: contextSchema,
};

export const trackEventSchema = z
  .object({
    type: z.literal('track'),
    event: z.string().trim().min(1).max(200),
    properties: jsonRecordSchema.optional(),
    ...baseEventFields,
  })
  .refine((value) => value.anonymousId || value.userId, {
    message: 'anonymousId or userId is required',
  });

export const identifyEventSchema = z
  .object({
    type: z.literal('identify'),
    traits: jsonRecordSchema.optional(),
    ...baseEventFields,
  })
  .refine((value) => value.anonymousId || value.userId, {
    message: 'anonymousId or userId is required',
  });

export const pageEventSchema = z
  .object({
    type: z.literal('page'),
    name: z.string().trim().max(200).optional(),
    properties: jsonRecordSchema.optional(),
    ...baseEventFields,
  })
  .refine((value) => value.anonymousId || value.userId, {
    message: 'anonymousId or userId is required',
  });

export const trackedEventSchema = z.discriminatedUnion('type', [
  trackEventSchema,
  identifyEventSchema,
  pageEventSchema,
]);

export const eventBatchSchema = z.object({
  batch: z.array(trackedEventSchema).min(1).max(500),
  /** Client clock at flush time; lets the pipeline correct for skew. */
  sentAt: isoTimestampSchema.optional(),
  /** sendBeacon cannot set headers, so the key may ride in the body. */
  writeKey: z.string().optional(),
});

export type TrackEvent = z.infer<typeof trackEventSchema>;
export type IdentifyEvent = z.infer<typeof identifyEventSchema>;
export type PageEvent = z.infer<typeof pageEventSchema>;
export type TrackedEvent = z.infer<typeof trackedEventSchema>;
export type EventBatch = z.infer<typeof eventBatchSchema>;

/**
 * The flat row produced by ingestion enrichment — what travels on the
 * event bus and lands in the ClickHouse `events` table.
 */
export interface EnrichedEvent {
  message_id: string;
  organization_id: string;
  workspace_id: string;
  type: TrackedEvent['type'];
  /** Event name for track, page name for page, '' for identify. */
  event: string;
  anonymous_id: string;
  user_id: string;
  /** JSON-encoded properties (track/page) or traits (identify). */
  properties: string;
  /** JSON-encoded client context. */
  context: string;
  /** Client event time, ISO 8601 UTC. */
  timestamp: string;
  /** Server receive time, ISO 8601 UTC. */
  received_at: string;
}
