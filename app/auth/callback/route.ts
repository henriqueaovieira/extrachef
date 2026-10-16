import { NextResponse, type NextRequest } from 'next/server';
import { createRequestClient } from '@/lib/supabase/request';
import { getAccountRole } from '@/lib/auth/account';
import { sanitizeRedirect } from '@/lib/auth/routes';

export async function GET(request: NextRequest) {
  const { supabase, finish } = createRequestClient(request);
  const redirect = request.nextUrl.searchParams.get('redirect');
  const failure = new URL('/login', request.url);
  if (redirect) failure.searchParams.set('redirect', redirect);
  failure.searchParams.set('reason', 'confirmation_failed');

  const code = request.nextUrl.searchParams.get('code');
  if (!code) return finish(NextResponse.redirect(failure));

  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      console.error('auth_confirmation_failed', { code: error?.code });
      return finish(NextResponse.redirect(failure));
    }
    const role = await getAccountRole(supabase, data.user.id, true);
    return finish(NextResponse.redirect(new URL(sanitizeRedirect(redirect, role), request.url)));
  } catch (error) {
    console.error('auth_confirmation_profile_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    return finish(NextResponse.redirect(failure));
  }
}
