import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

/** Prometheus registry for the tracking service. Scraped at /metrics. */
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const pixelServed = new Counter({
  name: 'helio_tracking_opens_total',
  help: 'Open-pixel hits that resolved to a send',
  registers: [metricsRegistry],
});

export const redirectsServed = new Counter({
  name: 'helio_tracking_clicks_total',
  help: 'Click redirects that resolved to a send',
  registers: [metricsRegistry],
});

export const trackingRejected = new Counter({
  name: 'helio_tracking_rejected_total',
  help: 'Tracking hits dropped, by reason',
  labelNames: ['reason'] as const,
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
