import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidReceipt(notificationId: string, subscriptionId: string, token: unknown) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  if (!secret || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = createHmac('sha256', secret)
    .update(`${notificationId}:${subscriptionId}`)
    .digest();
  const received = Buffer.from(token, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    notificationId?: unknown;
    subscriptionId?: unknown;
    receiptToken?: unknown;
  } | null;

  if (!isValidUuid(body?.notificationId)
    || !isValidUuid(body?.subscriptionId)
    || !isValidReceipt(body.notificationId, body.subscriptionId, body.receiptToken)) {
    return NextResponse.json({ error: 'Invalid push receipt.' }, { status: 401 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Push receipt service is not configured.' }, { status: 503 });
  }

  const { error } = await admin.rpc('record_push_delivery', {
    p_notification_id: body.notificationId,
    p_subscription_id: body.subscriptionId,
    p_status: 'received',
    p_status_code: null,
  });

  if (error) {
    console.error('Could not record a push receipt.');
    return NextResponse.json({ error: 'Could not record push receipt.' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
