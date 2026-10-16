import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password
      && (!endpoint.port || endpoint.port === '443') && (
      endpoint.hostname === 'fcm.googleapis.com'
      || endpoint.hostname.endsWith('.push.services.mozilla.com')
      || endpoint.hostname.endsWith('.push.apple.com')
      || endpoint.hostname.endsWith('.notify.windows.com')
    );
  } catch {
    return false;
  }
}

async function getAuthenticatedUser(request: Request, admin: ReturnType<typeof createAdminClient>) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

export async function POST(request: Request) {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Push service is not configured.' }, { status: 503 });
  }

  const user = await getAuthenticatedUser(request, admin);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const authSecret = body?.keys?.auth;

  if (!isAllowedPushEndpoint(endpoint)
    || typeof p256dh !== 'string' || !/^[A-Za-z0-9_\-=+\/]+$/.test(p256dh) || Buffer.from(p256dh, 'base64url').length !== 65
    || typeof authSecret !== 'string' || !/^[A-Za-z0-9_\-=+\/]+$/.test(authSecret) || Buffer.from(authSecret, 'base64url').length !== 16) {
    return NextResponse.json({ error: 'Invalid push subscription.' }, { status: 400 });
  }

  const { error } = await admin.from('push_subscriptions').upsert({
    // A browser endpoint is unique to this installation; binding it to the currently
    // authenticated account prevents a previous account on a shared device receiving Push.
    user_id: user.id,
    endpoint,
    p256dh,
    auth_secret: authSecret,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });

  if (error) return NextResponse.json({ error: 'Could not save push subscription.' }, { status: 500 });
  return NextResponse.json({ subscribed: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: 'Push service is not configured.' }, { status: 503 });
  }

  const user = await getAuthenticatedUser(request, admin);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const body = await request.json().catch(() => null) as { endpoint?: unknown } | null;
  if (!isAllowedPushEndpoint(body?.endpoint)) {
    return NextResponse.json({ error: 'Invalid push endpoint.' }, { status: 400 });
  }

  const { error } = await admin
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', body.endpoint);

  if (error) return NextResponse.json({ error: 'Could not remove push subscription.' }, { status: 500 });
  return NextResponse.json({ subscribed: false });
}