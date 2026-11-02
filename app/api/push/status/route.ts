import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AdminConfigurationError, createAdminClient, getAdminDiagnostics } from '@/lib/supabase/admin';
import { validateVapidPair } from '@/lib/push-config';

function diagnosticCode(error: { code?: string }) {
  return error.code && /^[a-z0-9_]{1,64}$/i.test(error.code) ? error.code : 'unknown';
}

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const requestId = randomUUID();
  const startedAt = Date.now();
  const detailed = process.env.PUSH_DIAGNOSTICS_ENABLED === 'true';
  let adminDiagnostics: ReturnType<typeof getAdminDiagnostics> | undefined;
  const timings: Record<string, number> = {};
  let stage = 'authentication_header';
  let stageStartedAt = startedAt;
  const enterStage = (next: string) => {
    timings[stage] = Date.now() - stageStartedAt;
    stage = next;
    stageStartedAt = Date.now();
  };
  const finish = (body: Record<string, unknown>, status = 200) => {
    timings[stage] = Date.now() - stageStartedAt;
    console.info('push_status_completed', {
      requestId, status, stage, durationMs: Date.now() - startedAt, timings,
    });
    return NextResponse.json({
      ...body,
      requestId,
      ...(detailed ? {
        step: stage,
        reason: typeof body.reason === 'string' ? body.reason
          : typeof body.code === 'string' ? body.code : status === 200 ? 'completed' : 'request_rejected',
        diagnostics: {
          version: 'admin-env-v2', timings, ...adminDiagnostics,
          ...(typeof body.diagnostics === 'object' && body.diagnostics !== null ? body.diagnostics : {}),
        },
      } : {}),
    }, {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
        ...(detailed ? { 'X-Push-Diagnostics-Version': 'admin-env-v2' } : {}),
      },
    });
  };

  console.info('push_status_started', { requestId });
  if (!token) return finish({ error: 'Authentication required.' }, 401);

  try {
    enterStage('admin_initialization');
    const admin = createAdminClient({ requestId });
    if (detailed) adminDiagnostics = getAdminDiagnostics();
    enterStage('auth_get_user');
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError) {
      const unavailable = !authError.status || authError.status >= 500;
      console.warn('push_status_auth_failed', {
        requestId, code: diagnosticCode(authError), upstreamStatus: authError.status ?? null,
      });
      return finish({
        error: unavailable ? 'Authentication service is unavailable.' : 'Authentication required.',
        code: unavailable ? 'AUTH_SERVICE_UNAVAILABLE' : 'AUTHENTICATION_REQUIRED',
      }, unavailable ? 503 : 401);
    }
    if (!authData.user) return finish({ error: 'Authentication required.' }, 401);

    enterStage('subscriptions_query');
    const { count, error } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', authData.user.id);
    if (error) {
      console.error('push_status_subscriptions_failed', { requestId, code: diagnosticCode(error) });
      return finish({ error: 'Could not inspect registered devices.' }, 500);
    }

    enterStage('notifications_query');
    const recentNotifications = await admin.from('notifications').select('id')
      .eq('user_id', authData.user.id).order('created_at', { ascending: false }).limit(10);
    if (recentNotifications.error) {
      console.warn('push_status_notifications_failed', {
        requestId, code: diagnosticCode(recentNotifications.error),
      });
    }
    const recentIds = (recentNotifications.data ?? []).map((notification) => notification.id);
    enterStage('deliveries_query');
    const deliveries = recentIds.length ? await admin.from('push_deliveries')
      .select('notification_id, status, status_code, updated_at')
      .in('notification_id', recentIds).order('updated_at', { ascending: false }).limit(20) : null;
    if (deliveries?.error) {
      console.warn('push_status_deliveries_failed', { requestId, code: diagnosticCode(deliveries.error) });
    }

    enterStage('push_configuration');
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY
      || process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY || '';
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '';
    const browserKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
    const environment = {
      vapidPublicKey: Boolean(publicKey.trim()),
      vapidPrivateKey: Boolean(privateKey.trim()),
      vapidSubject: Boolean(process.env.WEB_PUSH_SUBJECT?.trim()),
      appUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL?.trim()),
      webhookSecret: Boolean(process.env.PUSH_WEBHOOK_SECRET?.trim()),
      serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim()),
      browserVapidPublicKey: Boolean(browserKey?.trim()),
      vapidKeysMatch: validateVapidPair(publicKey, privateKey, browserKey),
    };
    const configured = Object.values(environment).every(Boolean);
    console.info('push_status_configuration_checked', { requestId, configured, environment });

    return finish({
      configured,
      environment,
      registeredDevices: count ?? 0,
      deliveries: deliveries?.data ?? [],
      deliveryHistoryAvailable: !recentNotifications.error && !deliveries?.error,
    });
  } catch (error) {
    if (error instanceof AdminConfigurationError) {
      console.error('push_status_admin_unavailable', { requestId, stage, code: error.code });
      return finish({
        error: 'Push status is unavailable because the administrative client could not be initialized.',
        code: 'PUSH_ADMIN_CONFIGURATION_ERROR',
        configured: false,
        ...(detailed ? { reason: error.code, diagnostics: error.diagnostics } : {}),
      }, 503);
    }
    console.error('push_status_unexpected_failure', { requestId, stage });
    return finish({ error: 'Could not inspect push status.', code: 'PUSH_STATUS_INTERNAL_ERROR' }, 500);
  }
}
