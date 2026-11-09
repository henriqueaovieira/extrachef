import type { NextRequest } from 'next/server';
import { authorizeStaffApi, hasSameOrigin, isUuid, parseStaffReason, rpcErrorStatus } from '@/lib/auth/staff-api';
import type { StaffRole } from '@/lib/auth/staff-access';

const staffRoles: StaffRole[] = ['admin', 'reviewer', 'support'];

export async function GET(request: NextRequest) {
  const context = await authorizeStaffApi(request, ['admin']);
  if (!context.ok) return context.response;

  const limitValue = Number(request.nextUrl.searchParams.get('limit') ?? 50);
  const offsetValue = Number(request.nextUrl.searchParams.get('offset') ?? 0);
  const limit = Number.isSafeInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 50;
  const offset = Number.isSafeInteger(offsetValue) ? Math.max(offsetValue, 0) : 0;
  const { data, error } = await context.supabase.rpc('list_staff_members', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    console.error('staff_api_list_failed', { code: error.code });
    return context.reply({ error: 'Não foi possível listar os membros Staff.' }, 503);
  }
  return context.reply({ staff: Array.isArray(data) ? data : [] }, 200);
}

export async function POST(request: NextRequest) {
  const context = await authorizeStaffApi(request, ['admin']);
  if (!context.ok) return context.response;
  if (!hasSameOrigin(request)) return context.reply({ error: 'Origem da solicitação inválida.' }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return context.reply({ error: 'Corpo JSON inválido.' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return context.reply({ error: 'Dados do membro inválidos.' }, 400);
  }

  const userId = Reflect.get(body, 'user_id');
  const role = Reflect.get(body, 'staff_role');
  const reason = parseStaffReason(Reflect.get(body, 'reason'));
  if (!isUuid(userId) || typeof role !== 'string' || !staffRoles.includes(role as StaffRole) || !reason) {
    return context.reply({ error: 'Informe usuário, papel Staff e justificativa válidos.' }, 400);
  }

  const { data, error } = await context.supabase.rpc('grant_staff_role', {
    p_user_id: userId,
    p_staff_role: role,
    p_reason: reason,
  });
  if (error) {
    console.warn('staff_api_grant_failed', { code: error.code });
    return context.reply(
      { error: 'Não foi possível conceder o acesso Staff.' },
      rpcErrorStatus(error.code),
    );
  }
  return context.reply({ membership: data }, 200);
}
