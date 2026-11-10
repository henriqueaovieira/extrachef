import { Buffer } from 'node:buffer';
import { requirePermission } from '@/lib/auth/admin-guards';
import type { AuthorizedStaffRequest } from '@/lib/auth/staff-api';
import { isUuid } from '@/lib/auth/staff-api';
import type { StaffRole } from '@/lib/auth/staff-access';

export const ADMIN_AUDIT_RPC = 'list_admin_audit_log';
export const ADMIN_AUDIT_DEFAULT_LIMIT = 50;
export const ADMIN_AUDIT_MAX_LIMIT = 100;

const auditActions = ['staff.granted', 'staff.role_changed', 'staff.revoked'] as const;
const cursorMaxLength = 2048;

export type AdminAuditFilters = {
  action: typeof auditActions[number] | null;
  actor_user_id: string | null;
  target_user_id: string | null;
  from: string | null;
  to: string | null;
};

export type AdminAuditQuery = {
  limit: number;
  cursor: string | null;
  filters: AdminAuditFilters;
};

export type AdminAuditEvent = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  target_user_id: string | null;
};

type AdminAuditCursor = {
  v: 1;
  filters: AdminAuditFilters;
  key: Pick<AdminAuditEvent, 'created_at' | 'id'>;
};

type QueryParseResult =
  | { ok: true; value: AdminAuditQuery }
  | { ok: false; error: string };

type AuthorizedContext = Extract<AuthorizedStaffRequest, { ok: true }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseIsoDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;

  const localDate = new Date(0);
  localDate.setUTCFullYear(year, month - 1, day);
  localDate.setUTCHours(hour, minute, second, 0);
  if (localDate.getUTCFullYear() !== year
    || localDate.getUTCMonth() !== month - 1
    || localDate.getUTCDate() !== day) {
    return null;
  }

  let offsetMinutes = 0;
  if (zone.toUpperCase() !== 'Z') {
    const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
    if (!offsetMatch) return null;
    const offsetHours = Number(offsetMatch[2]);
    const offsetRemainder = Number(offsetMatch[3]);
    if (offsetHours > 14 || offsetRemainder > 59 || (offsetHours === 14 && offsetRemainder !== 0)) {
      return null;
    }
    offsetMinutes = (offsetHours * 60 + offsetRemainder) * (offsetMatch[1] === '+' ? 1 : -1);
  }

  const utcMilliseconds = localDate.getTime() - offsetMinutes * 60_000;
  const utcSeconds = new Date(utcMilliseconds).toISOString().slice(0, 19);
  return `${utcSeconds}.${fraction.padEnd(6, '0')}Z`;
}

function parseOptionalUuid(value: string | undefined, label: string): QueryParseResult | string | null {
  if (value === undefined) return null;
  if (!isUuid(value)) return { ok: false, error: `O filtro ${label} deve ser um UUID válido.` };
  return value.toLowerCase();
}

function parseOptionalDate(value: string | undefined, label: string): QueryParseResult | string | null {
  if (value === undefined) return null;
  const normalized = parseIsoDateTime(value);
  if (!normalized) {
    return { ok: false, error: `O filtro ${label} deve ser uma data ISO 8601 com fuso horário.` };
  }
  return normalized;
}

export function parseAdminAuditQuery(searchParams: URLSearchParams): QueryParseResult {
  const allowed = new Set(['limit', 'cursor', 'action', 'actor_user_id', 'target_user_id', 'from', 'to']);
  const values = new Map<string, string>();
  for (const [key, value] of searchParams) {
    if (!allowed.has(key)) return { ok: false, error: 'Parâmetro de consulta desconhecido.' };
    if (values.has(key)) return { ok: false, error: `O parâmetro ${key} deve aparecer uma única vez.` };
    values.set(key, value);
  }

  const rawLimit = values.get('limit');
  let limit = ADMIN_AUDIT_DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    if (!/^[1-9]\d*$/.test(rawLimit)) {
      return { ok: false, error: 'O parâmetro limit deve ser um inteiro entre 1 e 100.' };
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit > ADMIN_AUDIT_MAX_LIMIT) {
      return { ok: false, error: 'O parâmetro limit deve ser um inteiro entre 1 e 100.' };
    }
  }

  const cursor = values.get('cursor') ?? null;
  if (cursor !== null && (cursor.length === 0 || cursor.length > cursorMaxLength)) {
    return { ok: false, error: 'O cursor é inválido.' };
  }

  const rawAction = values.get('action');
  if (rawAction !== undefined && !auditActions.includes(rawAction as typeof auditActions[number])) {
    return { ok: false, error: 'O filtro action não é válido.' };
  }

  const actor = parseOptionalUuid(values.get('actor_user_id'), 'actor_user_id');
  if (typeof actor !== 'string' && actor !== null) return actor;
  const target = parseOptionalUuid(values.get('target_user_id'), 'target_user_id');
  if (typeof target !== 'string' && target !== null) return target;
  const from = parseOptionalDate(values.get('from'), 'from');
  if (typeof from !== 'string' && from !== null) return from;
  const to = parseOptionalDate(values.get('to'), 'to');
  if (typeof to !== 'string' && to !== null) return to;
  if (from && to && from >= to) {
    return { ok: false, error: 'O filtro from deve ser anterior a to.' };
  }

  return {
    ok: true,
    value: {
      limit,
      cursor,
      filters: {
        action: rawAction as AdminAuditFilters['action'] ?? null,
        actor_user_id: actor,
        target_user_id: target,
        from,
        to,
      },
    },
  };
}

function isValidCursorFilters(value: unknown): value is AdminAuditFilters {
  if (!isRecord(value)
    || Object.keys(value).length !== 5
    || !(value.action === null || auditActions.includes(value.action as typeof auditActions[number]))
    || !(value.actor_user_id === null || (typeof value.actor_user_id === 'string' && isUuid(value.actor_user_id)))
    || !(value.target_user_id === null || (typeof value.target_user_id === 'string' && isUuid(value.target_user_id)))
    || !(value.from === null || (typeof value.from === 'string' && parseIsoDateTime(value.from) === value.from))
    || !(value.to === null || (typeof value.to === 'string' && parseIsoDateTime(value.to) === value.to))) {
    return false;
  }
  return true;
}

export function decodeAdminAuditCursor(
  token: string,
  filters: AdminAuditFilters,
): AdminAuditCursor | null {
  if (token.length > cursorMaxLength || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const bytes = Buffer.from(token, 'base64url');
    if (bytes.toString('base64url') !== token) return null;
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(parsed)
      || Object.keys(parsed).length !== 3
      || parsed.v !== 1
      || !isValidCursorFilters(parsed.filters)
      || JSON.stringify(parsed.filters) !== JSON.stringify(filters)
      || !isRecord(parsed.key)
      || Object.keys(parsed.key).length !== 2
      || typeof parsed.key.created_at !== 'string'
      || parseIsoDateTime(parsed.key.created_at) === null
      || typeof parsed.key.id !== 'string'
      || !isUuid(parsed.key.id)) {
      return null;
    }
    return {
      v: 1,
      filters: parsed.filters,
      key: {
        created_at: parsed.key.created_at,
        id: parsed.key.id.toLowerCase(),
      },
    };
  } catch {
    return null;
  }
}

export function encodeAdminAuditCursor(event: AdminAuditEvent, filters: AdminAuditFilters) {
  const cursor: AdminAuditCursor = {
    v: 1,
    filters,
    key: { created_at: event.created_at, id: event.id.toLowerCase() },
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && isUuid(value));
}

export function parseAdminAuditEvents(value: unknown): AdminAuditEvent[] | null {
  if (!Array.isArray(value)) return null;
  const events: AdminAuditEvent[] = [];
  for (const item of value) {
    if (!isRecord(item)
      || typeof item.id !== 'string'
      || !isUuid(item.id)
      || typeof item.created_at !== 'string'
      || parseIsoDateTime(item.created_at) === null
      || typeof item.action !== 'string'
      || item.action.trim() === ''
      || typeof item.entity_type !== 'string'
      || item.entity_type.trim() === ''
      || !isNullableUuid(item.entity_id)
      || !isNullableUuid(item.actor_user_id)
      || !isNullableUuid(item.target_user_id)) {
      return null;
    }
    events.push({
      id: item.id.toLowerCase(),
      created_at: item.created_at,
      action: item.action,
      entity_type: item.entity_type,
      entity_id: item.entity_id?.toLowerCase() ?? null,
      actor_user_id: item.actor_user_id?.toLowerCase() ?? null,
      target_user_id: item.target_user_id?.toLowerCase() ?? null,
    });
  }
  return events;
}

export function isAdminAuditEventsOrdered(events: AdminAuditEvent[]) {
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    const previousTimestamp = parseIsoDateTime(previous.created_at);
    const currentTimestamp = parseIsoDateTime(current.created_at);
    if (!previousTimestamp || !currentTimestamp) return false;
    if (previousTimestamp < currentTimestamp
      || (previousTimestamp === currentTimestamp && previous.id < current.id)) {
      return false;
    }
  }
  return true;
}

export function adminAuditRpcArgs(
  query: AdminAuditQuery,
  cursor: AdminAuditCursor | null,
) {
  return {
    p_limit: query.limit + 1,
    p_cursor_created_at: cursor?.key.created_at ?? null,
    p_cursor_id: cursor?.key.id ?? null,
    p_actor_user_id: query.filters.actor_user_id,
    p_target_user_id: query.filters.target_user_id,
    p_action: query.filters.action,
    p_from: query.filters.from,
    p_to: query.filters.to,
  };
}

export function adminAuditPermissionDenied(context: AuthorizedContext) {
  try {
    requirePermission({ role: context.role as StaffRole, status: 'active' }, 'audit.view');
    return null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'STAFF_PERMISSION_DENIED') {
      return context.reply({ error: 'Acesso administrativo não autorizado.' }, 403);
    }
    throw error;
  }
}
