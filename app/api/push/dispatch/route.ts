import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateVapidPair } from '@/lib/push-config';

function secretMatches(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('x-extra-chef-webhook-secret'), process.env.PUSH_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY
    || process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!publicKey || !privateKey || !subject || !appUrl) {
    return NextResponse.json({ error: 'Web Push is not configured.' }, { status: 503 });
  }
  if (!validateVapidPair(publicKey, privateKey, process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY)) {
    return NextResponse.json({ error: 'VAPID keys do not form a matching pair or differ from the browser key.' }, { status: 503 });
  }

  const payload = await request.json().catch(() => null) as {
    type?: string;
    record?: {
      id?: string;
      user_id?: string;
      title?: string;
      message?: string;
      url?: string | null;
      category?: string;
    };
  } | null;
  const eventNotification = payload?.record;
  if (payload?.type !== 'INSERT' || !eventNotification?.id || !eventNotification.user_id || !eventNotification.title || !eventNotification.message) {
    return NextResponse.json({ error: 'Invalid notification event.' }, { status: 400 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Supabase server credentials are not configured.' }, { status: 503 });
  }

  const { data: notification, error: notificationError } = await admin
    .from('notifications')
    .select('id, user_id, title, message, url, category, read, message_id')
    .eq('id', eventNotification.id)
    .eq('user_id', eventNotification.user_id)
    .maybeSingle();
  if (notificationError) {
    console.error('Could not load push notification.', { notificationId: eventNotification.id });
    return NextResponse.json({ error: 'Could not load notification.' }, { status: 500 });
  }
  if (!notification || notification.read) {
    return NextResponse.json({ sent: 0, suppressed: true, reason: 'notification_read_or_deleted' });
  }

  const { data: preferences, error: preferencesError } = await admin
    .from('notification_preferences')
    .select('messages_enabled, applications_enabled, reviews_enabled, operations_enabled, events_enabled')
    .eq('user_id', notification.user_id)
    .maybeSingle();

  if (preferencesError) {
    console.error('Could not load notification preferences.', { notificationId: notification.id });
    return NextResponse.json({ error: 'Could not load notification preferences.' }, { status: 500 });
  }

  const preferenceEnabled: Record<string, boolean> = {
    message: preferences?.messages_enabled ?? true,
    application: preferences?.applications_enabled ?? true,
    review: preferences?.reviews_enabled ?? true,
    operational: preferences?.operations_enabled ?? true,
    event: preferences?.events_enabled ?? true,
    reservation: preferences?.events_enabled ?? true,
  };

  if (!preferenceEnabled[notification.category ?? 'operational']) {
    return NextResponse.json({ sent: 0, suppressed: true, reason: 'preference_disabled' });
  }

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_secret')
    .eq('user_id', notification.user_id);

  if (error) return NextResponse.json({ error: 'Could not load push subscriptions.' }, { status: 500 });

  if (!subscriptions?.length) {
    console.info('Web Push has no registered devices.', { notificationId: notification.id });
    return NextResponse.json({ sent: 0, subscriptions: 0, reason: 'no_registered_devices' });
  }

  let destination: string;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const publicOrigin = new URL(appUrl).origin;
    const candidateUrl = new URL(notification.url || '/', publicOrigin);
    destination = candidateUrl.origin === publicOrigin ? candidateUrl.toString() : `${publicOrigin}/`;
  } catch {
    return NextResponse.json({ error: 'Web Push VAPID or application URL configuration is invalid.' }, { status: 503 });
  }
  const message = JSON.stringify({
    notificationId: notification.id,
    messageId: notification.message_id,
    category: notification.category ?? 'operational',
    title: notification.title,
    body: notification.message,
    url: destination,
  });

  const { data: previousDeliveries, error: deliveryReadError } = await admin
    .from('push_deliveries')
    .select('subscription_id')
    .eq('notification_id', notification.id)
    .in('status', ['sent', 'received']);

  if (deliveryReadError) {
    console.error('Could not inspect previous push deliveries.', { notificationId: notification.id });
    return NextResponse.json({ error: 'Could not inspect previous push deliveries.' }, { status: 500 });
  }

  const previouslySent = new Set((previousDeliveries ?? []).map((delivery) => delivery.subscription_id));
  let sent = 0;
  let failed = 0;
  const expiredIds: string[] = [];

  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    if (previouslySent.has(subscription.id)) return;

    let deliveryStatus: 'sent' | 'expired' | 'failed' = 'sent';
    let statusCode: number | null = null;
    const receiptToken = createHmac('sha256', process.env.PUSH_WEBHOOK_SECRET!)
      .update(`${notification.id}:${subscription.id}`)
      .digest('hex');
    try {
      const providerResult = await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
      }, JSON.stringify({
        ...JSON.parse(message),
        subscriptionId: subscription.id,
        receiptToken,
      }), { TTL: 300, timeout: 10000 });
      statusCode = providerResult.statusCode;
      sent += 1;
    } catch (sendError) {
      const providerStatusCode = (sendError as { statusCode?: number }).statusCode;
      if (providerStatusCode === 404 || providerStatusCode === 410) {
        expiredIds.push(subscription.id);
        deliveryStatus = 'expired';
      } else {
        failed += 1;
        deliveryStatus = 'failed';
      }
      console.error('Web Push provider rejected a delivery.', {
        notificationId: notification.id,
        subscriptionId: subscription.id,
        statusCode: providerStatusCode ?? null,
      });
      statusCode = providerStatusCode ?? null;
    }

    const { error: deliveryWriteError } = await admin.rpc('record_push_delivery', {
      p_notification_id: notification.id,
      p_subscription_id: subscription.id,
      p_status: deliveryStatus,
      p_status_code: statusCode,
    });

    if (deliveryWriteError) {
      failed += 1;
      console.error('Could not record push delivery result.', {
        notificationId: notification.id,
        subscriptionId: subscription.id,
      });
    }
  }));

  if (expiredIds.length > 0) {
    const { error: deleteError } = await admin.from('push_subscriptions').delete().in('id', expiredIds);
    if (deleteError) {
      console.error('Could not remove expired push subscriptions.', { count: expiredIds.length });
      return NextResponse.json({ error: 'Push sent, but expired subscriptions could not be removed.' }, { status: 500 });
    }
  }

  if (failed > 0) {
    return NextResponse.json({ sent, failed, expired: expiredIds.length }, { status: 502 });
  }

  console.info('Web Push dispatch completed.', {
    notificationId: notification.id, sent, failed, expired: expiredIds.length,
    subscriptions: subscriptions?.length ?? 0,
  });
  return NextResponse.json({
    sent,
    failed,
    expired: expiredIds.length,
    subscriptions: subscriptions?.length ?? 0,
  });
}