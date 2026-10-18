import { NextResponse, type NextRequest } from 'next/server';
import { createRequestClient } from '@/lib/supabase/request';
import { canAccessPath, dashboardFor, isAccountRole, loginHref } from '@/lib/auth/routes';

export async function proxy(request: NextRequest) {
  const { supabase, finish } = createRequestClient(request);
  const original = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const hadSession = request.cookies.getAll().some(({ name }) => (
    name.startsWith('sb-') && name.includes('-auth-token') && !name.includes('code-verifier')
  ));

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError'
      && (!error.status || error.status >= 500)) {
      console.error('auth_validation_unavailable', { route: request.nextUrl.pathname, code: error.code });
      return finish(new NextResponse('Não foi possível validar sua sessão. Tente novamente.', { status: 503 }));
    }
    if (error || !data.user) {
      return finish(NextResponse.redirect(new URL(
        loginHref(original, hadSession ? 'session_expired' : undefined), request.url,
      )));
    }

    const { data: account, error: accountError } = await supabase
      .from('users').select('role').eq('id', data.user.id).maybeSingle();
    if (accountError) {
      console.error('account_role_unavailable', { route: request.nextUrl.pathname, code: accountError.code });
      return finish(new NextResponse('Não foi possível carregar seu perfil. Tente novamente.', { status: 503 }));
    }
    if (!isAccountRole(account?.role)) {
      const login = new URL(loginHref(original), request.url);
      login.searchParams.set('reason', 'profile_unavailable');
      return finish(NextResponse.redirect(login));
    }
    if (!canAccessPath(request.nextUrl.pathname, account.role)) {
      return finish(NextResponse.redirect(new URL(
        `${dashboardFor(account.role)}?reason=role_forbidden`, request.url,
      )));
    }
    return finish();
  } catch (error) {
    console.error('auth_request_failed', {
      route: request.nextUrl.pathname,
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    return finish(new NextResponse('Não foi possível validar sua sessão. Tente novamente.', { status: 503 }));
  }
}

export const config = {
  matcher: [
    '/restaurant/:path*', '/worker/:path*', '/chat/:path*',
    '/checkin/:path*', '/checkout/:path*', '/payment/:path*', '/reviews/:path*',
    '/notifications/:path*', '/settings/:path*', '/profile/:path*',
  ],
};
