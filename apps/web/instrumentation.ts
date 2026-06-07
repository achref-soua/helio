import { registerOTel } from '@vercel/otel';

/**
 * Next.js instrumentation hook: traces server rendering, route handlers,
 * and fetches. Exports over OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set
 * (the compose observability profile provides a collector).
 */
export function register() {
  registerOTel({ serviceName: 'helio-web' });
}
