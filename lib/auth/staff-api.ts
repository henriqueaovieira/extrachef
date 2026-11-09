import 'server-only';
import { connection, NextResponse, type NextRequest } from 'next/server';
import { parseStaffMembership, type StaffRole } from '@/lib/auth/staff-access';
import { createRequestClient } from '@/lib/supabase/request';

type Reply = (body: object, status: number) => NextResponse;

export type AuthorizedStaffRequest = {
  ok: true;
  supabase: ReturnType<typeof createRequestClient>['supabase'];
  userId: string;
  role: StaffRole;
  reply: Reply;
} | {
  ok: false;
  response: NextResponse;
};

export async function authorizeStaffApi(request: NextRequest, roles?: StaffRole[]): Promise<AuthorizedStaffRequest> {
  await connection();
  const { supabase, finish } = createRequestClient(request);
  const reply: Reply = (body, status) => {
    const response = finish(NextResponse.json(body, { status }));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  };
  const deny = (error: string, status: number) => ({
    ok: false as const,
    response: reply({ error }, status),
  });

  let auth: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    auth = await supabase.auth.getUser();
  } catch (error) {
    console.error('staff_api_auth_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    return deny('Não foi possível validar sua sessão.', 503);
  }
  if (auth.error && (!auth.error.status || auth.error.status >= 500)) {
    console.error('staff_api_auth_unavailable', { code: auth.error.code });
    return deny('Não foi possível validar sua sessão.', 503);
  }
  if (auth.error || !auth.data.user) return deny('Autenticação necessária.', 401);

  const { data, error } = await supabase.rpc('get_staff_membership');
  if (error) {
    console.error('staff_api_membership_unavailable', { code: error.code });
    return deny('Não foi possível validar seu acesso administrativo.', 503);
  }
  const membership = parseStaffMembership(data);
  if (!membership || membership.status !== 'active') {
    return deny('Acesso administrativo não autorizado.', 403);
  }
  if (roles && !roles.includes(membership.role)) {
    return deny('Acesso administrativo não autorizado.', 403);
  }

  return {
    ok: true,
    supabase,
    userId: auth.data.user.id,
    role: membership.role,
    reply,
  };
}

export function hasSameOrigin(request: NextRequest) {
  const expectedOrigin = request.nextUrl.origin;
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function rpcErrorStatus(code?: string) {
  if (code === '42501') return 403;
  if (code === '23505' || code === '23514' || code === '40001') return 409;
  if (code === '22023' || code === '22P02') return 400;
  if (code === 'P0002') return 404;
  return 503;
}

export function parseStaffReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason.length > 0 && reason.length <= 500 ? reason : null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
