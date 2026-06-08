import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/** Prometheus registry for the ingestion service. Scraped at /metrics. */
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestDuration = new Histogram({
  name: 'helio_ingest_http_request_duration_seconds',
  help: 'HTTP request duration by route, method, and status',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

export const eventsAccepted = new Counter({
  name: 'helio_ingest_events_accepted_total',
  help: 'Events accepted and published to the bus, by type',
  labelNames: ['type'] as const,
  registers: [metricsRegistry],
});

export const batchesRejected = new Counter({
  name: 'helio_ingest_batches_rejected_total',
  help: 'Rejected ingestion requests by reason',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
});

export const sinkRowsInserted = new Counter({
  name: 'helio_ingest_sink_rows_inserted_total',
  help: 'Rows the ClickHouse sink has inserted',
  registers: [metricsRegistry],
});

export const sinkInsertFailures = new Counter({
  name: 'helio_ingest_sink_insert_failures_total',
  help: 'ClickHouse insert batches that failed (will be redelivered)',
  registers: [metricsRegistry],
});

/**
 * Optional OpenTelemetry tracing: activates only when an OTLP endpoint is
 * configured, so local dev without the observability profile stays clean.
 */
export async function startTracing(serviceName: string): Promise<void> {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const [{ NodeSDK }, { OTLPTraceExporter }, { getNodeAutoInstrumentations }] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/auto-instrumentations-node'),
  ]);
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
}
