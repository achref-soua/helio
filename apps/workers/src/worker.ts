/* eslint-disable no-console -- process entrypoint logs lifecycle */
import { createClient as createClickHouseClient } from '@clickhouse/client';
import { SENDS_TASK_QUEUE } from '@helio/core';
import { createPrismaClient } from '@helio/db';
import { Client as TemporalClient, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { pino } from 'pino';

import { createActivities } from './activities';
import type { CredentialReader } from './credential-store';
import { SmtpEmailProvider } from './email-provider';
import { createEmailSenderResolver } from './email-provider-factory';
import { env } from './env';
import { createJourneyActivities } from './journey-activities';
import { createSmsResolver, createWhatsAppResolver } from './messaging-provider-factory';
import { WebPushProvider } from './push-provider';
import { TwilioSmsProvider } from './sms-provider';
import { JourneyTriggerConsumer } from './trigger-consumer';
import { createWebhookActivities } from './webhook-activities';
import { CloudWhatsAppProvider } from './whatsapp-provider';

const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });

const prisma = createPrismaClient(env.DATABASE_ADMIN_URL);
const provider = new SmtpEmailProvider({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
});

// Structural cast at the composition root: the store reads one delegate
// with a fixed query shape; tests stub that same narrow surface.
const resolveEmailSender = createEmailSenderResolver(prisma as unknown as CredentialReader, {
  provider,
  from: env.MAIL_FROM,
});

const activityConfig = {
  appUrl: env.APP_URL,
  trackingUrl: env.PUBLIC_TRACKING_URL,
  trackingSecret: env.TRACKING_SECRET,
  unsubscribeSecret: env.UNSUBSCRIBE_SECRET,
  webhookSecret: env.WEBHOOK_SIGNING_SECRET,
};

const clickhouse = createClickHouseClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DB,
});

const worker = await Worker.create({
  connection,
  namespace: env.TEMPORAL_NAMESPACE,
  taskQueue: SENDS_TASK_QUEUE,
  workflowsPath: new URL('./workflows.ts', import.meta.url).pathname,
  activities: {
    ...createActivities(prisma, resolveEmailSender, activityConfig, clickhouse),
    ...createJourneyActivities(
      prisma,
      resolveEmailSender,
      activityConfig,
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? new WebPushProvider({
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT,
          })
        : undefined,
      createSmsResolver(
        prisma as unknown as CredentialReader,
        env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
          ? new TwilioSmsProvider({
              accountSid: env.TWILIO_ACCOUNT_SID,
              authToken: env.TWILIO_AUTH_TOKEN,
              from: env.TWILIO_FROM,
            })
          : undefined,
      ),
      createWhatsAppResolver(
        prisma as unknown as CredentialReader,
        env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN
          ? new CloudWhatsAppProvider({
              phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
              accessToken: env.WHATSAPP_ACCESS_TOKEN,
            })
          : undefined,
      ),
    ),
    ...createWebhookActivities(),
  },
});

let triggers: JourneyTriggerConsumer | undefined;
let clientConnection: Connection | undefined;
if (env.JOURNEY_TRIGGERS_ENABLED) {
  clientConnection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  const temporal = new TemporalClient({
    connection: clientConnection,
    namespace: env.TEMPORAL_NAMESPACE,
  });
  triggers = new JourneyTriggerConsumer(
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
// Temporal's runtime owns SIGTERM/SIGINT: the worker stops polling, drains
// in-flight activities, then run() resolves. What follows is the disposal
// that used to be skipped — without it the trigger consumer kept the
// process alive until the supervisor sent SIGKILL.
await worker.run();
console.log('worker drained, disposing');
if (triggers) await triggers.stop().catch(() => undefined);
if (clientConnection) await clientConnection.close().catch(() => undefined);
await prisma.$disconnect().catch(() => undefined);
await clickhouse.close().catch(() => undefined);
await connection.close().catch(() => undefined);
console.log('worker shut down cleanly');
