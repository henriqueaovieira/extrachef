import { NextResponse, type NextRequest } from 'next/server';
import { createRequestClient } from '@/lib/supabase/request';
import { getAccountRole } from '@/lib/auth/account';
import { sanitizeRedirect } from '@/lib/auth/routes';
import { PASSWORD_RESET_PATH, authCallbackFailureReason, authCallbackFlow } from '@/lib/auth/password-recovery';

export async function GET(request: NextRequest) {
  const { supabase, finish } = createRequestClient(request);
  const params = request.nextUrl.searchParams;
  const flow = authCallbackFlow(params);
  const redirect = params.get('redirect');
  const fail = (reason: string) => {
    const failure = new URL('/login', request.url);
    if (redirect && flow === 'signup') failure.searchParams.set('redirect', redirect);
    failure.searchParams.set('reason', reason);
    return finish(NextResponse.redirect(failure));
  };

  const providerError = params.get('error_code') ?? params.get('error');
  if (providerError) {
    console.error('auth_callback_link_rejected', { flow, code: providerError });
    return fail(authCallbackFailureReason(flow, providerError, params.get('error_description')));
  }

  const code = params.get('code');
  if (!code) return fail(authCallbackFailureReason(flow));

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      console.error('auth_callback_exchange_failed', { flow, code: error?.code });
      return fail(authCallbackFailureReason(flow, error?.code, error?.message));
    }
    if (flow === 'recovery') return finish(NextResponse.redirect(new URL(PASSWORD_RESET_PATH, request.url)));
    const role = await getAccountRole(supabase, data.user.id, true);
    return finish(NextResponse.redirect(new URL(sanitizeRedirect(redirect, role), request.url)));
  } catch (error) {
    console.error('auth_callback_failed', {
      flow,
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    return fail(flow === 'recovery' ? 'recovery_failed' : 'confirmation_failed');
  }
}
