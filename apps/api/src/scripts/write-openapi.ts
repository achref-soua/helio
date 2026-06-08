/* eslint-disable no-console -- operator-facing script */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { createApp } from '../app';

/**
 * Regenerate the committed OpenAPI document. The contract test fails when
 * this file drifts from the code, so spec changes are always reviewed.
 */
const app = createApp({
  prisma: {} as never,
  redis: {} as never,
  rateLimit: { max: 100, windowSeconds: 60 },
});

const document = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Helio API', version: '0.1.0' },
});

const target = path.resolve(import.meta.dirname, '../../openapi.json');
writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
console.log(`wrote ${target}`);
