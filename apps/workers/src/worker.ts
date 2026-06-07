/* eslint-disable no-console -- process entrypoint logs lifecycle */
import { SENDS_TASK_QUEUE } from '@helio/core';
import { createPrismaClient } from '@helio/db';
import { NativeConnection, Worker } from '@temporalio/worker';

import { createActivities } from './activities';
import { SmtpEmailProvider } from './email-provider';
import { env } from './env';

const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

const prisma = createPrismaClient(env.DATABASE_ADMIN_URL);
const provider = new SmtpEmailProvider({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
});

const worker = await Worker.create({
  connection,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: SENDS_TASK_QUEUE,
  workflowsPath: new URL('./workflows.ts', import.meta.url).pathname,
  activities: createActivities(prisma, provider, {
    mailFrom: env.MAIL_FROM,
    appUrl: env.APP_URL,
    trackingUrl: env.PUBLIC_TRACKING_URL,
    trackingSecret: env.TRACKING_SECRET,
    unsubscribeSecret: env.UNSUBSCRIBE_SECRET,
  }),
});

console.log(`helio worker polling ${SENDS_TASK_QUEUE} @ ${env.TEMPORAL_ADDRESS}`);
await worker.run();
