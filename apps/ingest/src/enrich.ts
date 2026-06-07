import { type EnrichedEvent, newId, type TrackedEvent } from '@helio/core';

/**
 * Flatten a validated wire event into the bus/ClickHouse row shape.
 * The server is the source of truth for received_at; the client clock
 * only fills `timestamp` (defaulting to received_at when absent).
 */
export function enrichEvent(
  event: TrackedEvent,
  scope: { organizationId: string; workspaceId: string },
  receivedAt: Date,
): EnrichedEvent {
  const payload = event.type === 'identify' ? (event.traits ?? {}) : (event.properties ?? {});
  return {
    message_id: event.messageId ?? newId('msg'),
    organization_id: scope.organizationId,
    workspace_id: scope.workspaceId,
    type: event.type,
    event: event.type === 'track' ? event.event : event.type === 'page' ? (event.name ?? '') : '',
    anonymous_id: event.anonymousId ?? '',
    user_id: event.userId ?? '',
    properties: JSON.stringify(payload),
    context: JSON.stringify(event.context ?? {}),
    timestamp: event.timestamp ?? receivedAt.toISOString(),
    received_at: receivedAt.toISOString(),
  };
}
