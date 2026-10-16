import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateVapidPair } from '@/lib/push-config';

export async function GET(request: Request) {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({
      error: 'Push status is unavailable because server credentials are not configured.',
      configured: false,
    }, { status: 503 });
  }

  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const { count, error } = await admin
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', authData.user.id);
  if (error) return NextResponse.json({ error: 'Could not inspect registered devices.' }, { status: 500 });

  const recentNotifications = await admin.from('notifications').select('id')
    .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(10);
  const recentIds = (recentNotifications.data ?? []).map((notification) => notification.id);
  const deliveries = recentIds.length ? await admin.from('push_deliveries')
    .select('notification_id, status, status_code, updated_at')
    .in('notification_id', recentIds).order('updated_at', { ascending: false }).limit(20) : null;

  const publicKeyPresent = Boolean(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY
    || process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
  );
  const privateKeyPresent = Boolean(process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
  const subjectPresent = Boolean(process.env.WEB_PUSH_SUBJECT);
  const appUrlPresent = Boolean(process.env.NEXT_PUBLIC_APP_URL);
  const webhookSecretPresent = Boolean(process.env.PUSH_WEBHOOK_SECRET);
  const serviceRolePresent = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const pairValid = validateVapidPair(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY || '',
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '',
    process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
  );

  return NextResponse.json({
    configured: publicKeyPresent && privateKeyPresent && subjectPresent && appUrlPresent
      && webhookSecretPresent && serviceRolePresent && pairValid,
    environment: {
      vapidPublicKey: publicKeyPresent,
      vapidPrivateKey: privateKeyPresent,
      vapidSubject: subjectPresent,
      appUrl: appUrlPresent,
      webhookSecret: webhookSecretPresent,
      serviceRole: serviceRolePresent,
      vapidKeysMatch: pairValid,
    },
    registeredDevices: count ?? 0,
    deliveries: deliveries?.data ?? [],
    deliveryHistoryAvailable: !recentNotifications.error && !deliveries?.error,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
