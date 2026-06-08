import { z } from 'zod';

/**
 * Web Push wire contract. The browser's PushSubscription serializes to
 * this shape; the SDK posts it to the ingestion service, which persists
 * it for the journey push node.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
  /** Optional identity hints, mirroring the tracking SDK. */
  userId: z.string().min(1).max(128).optional(),
  anonymousId: z.string().min(1).max(64).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** What the worker delivers; rendered from the journey node. */
export interface PushNotification {
  title: string;
  body: string;
  url?: string;
}
