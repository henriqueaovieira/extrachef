import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

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

  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!publicKey || !privateKey || !subject || !appUrl) {
    return NextResponse.json({ error: 'Web Push is not configured.' }, { status: 503 });
  }

  const payload = await request.json().catch(() => null) as {
    type?: string;
    record?: { id?: string; user_id?: string; title?: string; message?: string; url?: string | null };
  } | null;
  const notification = payload?.record;
  if (payload?.type !== 'INSERT' || !notification?.id || !notification.user_id || !notification.title || !notification.message) {
    return NextResponse.json({ error: 'Invalid notification event.' }, { status: 400 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Supabase server credentials are not configured.' }, { status: 503 });
  }

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_secret')
    .eq('user_id', notification.user_id);

  if (error) return NextResponse.json({ error: 'Could not load push subscriptions.' }, { status: 500 });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const publicOrigin = new URL(appUrl).origin;
  const candidateUrl = new URL(notification.url || '/', publicOrigin);
  const destination = candidateUrl.origin === publicOrigin ? candidateUrl.toString() : `${publicOrigin}/`;
  const message = JSON.stringify({ title: notification.title, body: notification.message, url: destination });
  let sent = 0;
  const expiredIds: string[] = [];

  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret },
      }, message, { TTL: 300 });
      sent += 1;
    } catch (sendError) {
      const statusCode = (sendError as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) expiredIds.push(subscription.id);
    }
  }));

  if (expiredIds.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', expiredIds);
  }

  return NextResponse.json({ sent, expired: expiredIds.length });
}