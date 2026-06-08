import type { PushNotification } from '@helio/core';
import webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = 'sent' | 'gone' | 'failed';

/** Delivery adapter for Web Push — VAPID over the browser push service. */
export interface PushProvider {
  send(target: PushTarget, notification: PushNotification): Promise<PushResult>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export class WebPushProvider implements PushProvider {
  constructor(private readonly vapid: VapidConfig) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(target: PushTarget, notification: PushNotification): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(notification),
      );
      return 'sent';
    } catch (error) {
      // 404/410 mean the subscription is dead — caller prunes it.
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      return 'failed';
    }
  }
}

/** Test double: records sends; can mark endpoints gone or failing. */
export class InMemoryPushProvider implements PushProvider {
  readonly sent: Array<{ target: PushTarget; notification: PushNotification }> = [];
  gone = new Set<string>();
  failing = new Set<string>();

  send(target: PushTarget, notification: PushNotification): Promise<PushResult> {
    if (this.gone.has(target.endpoint)) return Promise.resolve('gone');
    if (this.failing.has(target.endpoint)) return Promise.resolve('failed');
    this.sent.push({ target, notification });
    return Promise.resolve('sent');
  }
}
