import type { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/admin-guards';
import type { StaffPermission } from '@/lib/auth/staff-permissions';
import { authorizeStaffApi, hasSameOrigin, isUuid, parseStaffReason, rpcErrorStatus } from '@/lib/auth/staff-api';

function permissionErrorResponse(
  context: Extract<Awaited<ReturnType<typeof authorizeStaffApi>>, { ok: true }>,
  permission: StaffPermission,
) {
  try {
    requirePermission({ role: context.role, status: 'active' }, permission);
    return null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'STAFF_PERMISSION_DENIED') {
      return context.reply({ error: 'Acesso administrativo não autorizado.' }, 403);
    }
    throw error;
  }
}

export async function POST(request: NextRequest, context: RouteContext<'/api/admin/staff/[id]/revoke'>) {
  const authorization = await authorizeStaffApi(request);
  if (!authorization.ok) return authorization.response;
  const denied = permissionErrorResponse(authorization, 'staff.manage');
  if (denied) return denied;
  if (!hasSameOrigin(request)) return authorization.reply({ error: 'Origem da solicitação inválida.' }, 403);

  const { id } = await context.params;
  if (!isUuid(id)) return authorization.reply({ error: 'Identificador de membro inválido.' }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return authorization.reply({ error: 'Corpo JSON inválido.' }, 400);
  }
  const reason = body && typeof body === 'object'
    ? parseStaffReason(Reflect.get(body, 'reason'))
    : null;
  if (!reason) return authorization.reply({ error: 'Informe uma justificativa válida.' }, 400);

  const { data, error } = await authorization.supabase.rpc('revoke_staff_role', {
    p_user_id: id,
    p_reason: reason,
  });
  if (error) {
    console.warn('staff_api_revoke_failed', { code: error.code });
    return authorization.reply(
      { error: 'Não foi possível revogar o acesso Staff.' },
      rpcErrorStatus(error.code),
    );
  }
  return authorization.reply({ membership: data }, 200);
}
