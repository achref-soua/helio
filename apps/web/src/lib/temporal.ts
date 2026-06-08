import { Client, Connection } from '@temporalio/client';

import { env } from './env';

/**
 * Lazy Temporal client: the dashboard only dials the server when an
 * operator actually launches a campaign, so the core compose profile
 * (no Temporal) keeps working for everything else.
 */
const globalForTemporal = globalThis as unknown as { temporalClient?: Promise<Client> };

export function getTemporalClient(): Promise<Client> {
  globalForTemporal.temporalClient ??= Connection.connect({
    address: env.TEMPORAL_ADDRESS,
    connectTimeout: '5s',
  }).then((connection) => new Client({ connection, namespace: env.TEMPORAL_NAMESPACE }));
  return globalForTemporal.temporalClient;
}
