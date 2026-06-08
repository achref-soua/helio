/* eslint-disable no-console -- process entrypoint logs lifecycle */
import { SENDS_TASK_QUEUE } from '@helio/core';
import { createPrismaClient } from '@helio/db';
import { Client as TemporalClient, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { pino } from 'pino';

import { createActivities } from './activities';
import { SmtpEmailProvider } from './email-provider';
import { env } from './env';
import { createJourneyActivities } from './journey-activities';
import { JourneyTriggerConsumer } from './trigger-consumer';

const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

const prisma = createPrismaClient(env.DATABASE_ADMIN_URL);
const provider = new SmtpEmailProvider({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
});

const activityConfig = {
  mailFrom: env.MAIL_FROM,
  appUrl: env.APP_URL,
  trackingUrl: env.PUBLIC_TRACKING_URL,
  trackingSecret: env.TRACKING_SECRET,
  unsubscribeSecret: env.UNSUBSCRIBE_SECRET,
  webhookSecret: env.WEBHOOK_SIGNING_SECRET,
};

const worker = await Worker.create({
  connection,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: SENDS_TASK_QUEUE,
  workflowsPath: new URL('./workflows.ts', import.meta.url).pathname,
  activities: {
    ...createActivities(prisma, provider, activityConfig),
    ...createJourneyActivities(prisma, provider, activityConfig),
  },
});

if (env.JOURNEY_TRIGGERS_ENABLED) {
  const clientConnection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  const temporal = new TemporalClient({
    connection: clientConnection,
    namespace: env.TEMPORAL_NAMESPACE,
  });
  const triggers = new JourneyTriggerConsumer(
    { prisma, temporal, logger: pino({ level: process.env.LOG_LEVEL ?? 'info' }) },
    {
      brokers: env.KAFKA_BROKERS.split(',').map((broker) => broker.trim()),
      topic: env.EVENTS_TOPIC,
    },
  );
  triggers.start().catch((error) => {
    console.error('journey trigger consumer crashed', error);
    process.exitCode = 1;
  });
}

console.log(`helio worker polling ${SENDS_TASK_QUEUE} @ ${env.TEMPORAL_ADDRESS}`);
await worker.run();
