import type { NextRequest } from 'next/server';
import { authorizeStaffApi } from '@/lib/auth/staff-api';
import {
  ADMIN_AUDIT_MAX_LIMIT,
  ADMIN_AUDIT_RPC,
  adminAuditPermissionDenied,
  adminAuditRpcArgs,
  decodeAdminAuditCursor,
  encodeAdminAuditCursor,
  isAdminAuditEventsOrdered,
  parseAdminAuditEvents,
  parseAdminAuditQuery,
} from '@/lib/auth/admin-audit';

export async function GET(request: NextRequest) {
  const context = await authorizeStaffApi(request);
  if (!context.ok) return context.response;

  const denied = adminAuditPermissionDenied(context);
  if (denied) return denied;

  const parsedQuery = parseAdminAuditQuery(request.nextUrl.searchParams);
  if (!parsedQuery.ok) return context.reply({ error: parsedQuery.error }, 400);
  const query = parsedQuery.value;
  const cursor = query.cursor
    ? decodeAdminAuditCursor(query.cursor, query.filters)
    : null;
  if (query.cursor && !cursor) {
    return context.reply({ error: 'O cursor é inválido ou não corresponde aos filtros.' }, 400);
  }

  let result: Awaited<ReturnType<typeof context.supabase.rpc>>;
  try {
    result = await context.supabase.rpc(
      ADMIN_AUDIT_RPC,
      adminAuditRpcArgs(query, cursor),
    );
  } catch (error) {
    console.error('admin_audit_query_failed', {
      type: error instanceof Error ? error.name : 'UnknownError',
    });
    return context.reply({ error: 'Não foi possível consultar a trilha administrativa.' }, 503);
  }
  if (result.error) {
    console.error('admin_audit_query_failed', { code: result.error.code });
    return context.reply({ error: 'Não foi possível consultar a trilha administrativa.' }, 503);
  }

  const events = parseAdminAuditEvents(result.data);
  if (!events
    || events.length > query.limit + 1
    || events.length > ADMIN_AUDIT_MAX_LIMIT + 1
    || !isAdminAuditEventsOrdered(events)) {
    console.error('admin_audit_query_invalid_response');
    return context.reply({ error: 'Não foi possível consultar a trilha administrativa.' }, 503);
  }

  const hasMore = events.length > query.limit;
  const page = events.slice(0, query.limit);
  return context.reply({
    events: page,
    next_cursor: hasMore && page.length > 0
      ? encodeAdminAuditCursor(page[page.length - 1], query.filters)
      : null,
  }, 200);
}
