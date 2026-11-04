import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperationalContext } from '@/lib/operations';

export type TeamStateKey =
  | 'review' | 'payment' | 'receipt' | 'checkout_code' | 'checkout' | 'checkin_code' | 'checkin_late'
  | 'working' | 'waiting' | 'future' | 'absent' | 'abandoned' | 'completed';

export interface TeamHire {
  context: OperationalContext;
  state: TeamStateKey;
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  priority: number;
  detail: string | null;
  action: { label: string; href: string } | null;
}

interface AssignmentRow {
  job_id: string;
  worker_id: string;
  checkout_at: string | null;
  interruption: string | null;
  interrupted_at: string | null;
}

const DAY = 86_400_000;
const INCIDENT_VISIBILITY = DAY;

export function formatClock(value: string | Date) {
  const date = new Date(value);
  const hours = date.toLocaleString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' });
  const minutes = date.toLocaleString('pt-BR', { minute: '2-digit', timeZone: 'America/Sao_Paulo' }).padStart(2, '0');
  return `${Number(hours)}h${minutes === '00' ? '' : minutes}`;
}

export function formatTime(value: string | Date) {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function dayKey(value: Date) {
  return value.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function formatHireDay(startsAt: string, now = new Date()) {
  const start = new Date(startsAt);
  const days = Math.round((Date.parse(dayKey(start)) - Date.parse(dayKey(now))) / DAY);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Amanhã';
  if (days === -1) return 'Ontem';
  const weekday = start.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
  const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  if (days > 1 && days < 7) return label;
  return `${label.split('-')[0]}, ${start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
}

function countdown(target: Date, now: Date) {
  const minutes = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

/** Maps the existing operational phase (restaurant view) to the Equipe card state and next action. */
export function describeHire(context: OperationalContext, now = new Date()): TeamHire {
  const id = context.job_id;
  const startsAt = new Date(context.starts_at);
  const codeValid = Boolean(context.code && context.code_expires_at && new Date(context.code_expires_at) > now);
  const checkedIn = context.checkin_at ? `✅ Check-in realizado às ${formatTime(context.checkin_at)}` : null;
  const base = { context, detail: null as string | null };
  switch (context.phase) {
    case 'completed':
      return context.review_pending
        ? { ...base, state: 'review', label: '⭐ Avaliação obrigatória', tone: 'warning', priority: 1, detail: 'Avalie para continuar criando demandas e contratando.', action: { label: 'Avaliar profissional', href: `/reviews/${id}` } }
        : { ...base, state: 'completed', label: '✅ Operação concluída', tone: 'success', priority: 11, action: null };
    case 'payment':
    case 'payment_disputed':
      return { ...base, state: 'payment', label: '💰 Pagamento pendente', tone: 'warning', priority: 2,
        detail: context.phase === 'payment_disputed' ? 'O profissional informou que não recebeu.' : 'Pague o profissional e registre o pagamento.',
        action: { label: 'Confirmar pagamento', href: `/payment/${id}` } };
    case 'receipt':
      return { ...base, state: 'receipt', label: '⏳ Aguardando confirmação do pagamento', tone: 'neutral', priority: 3,
        detail: 'O profissional precisa confirmar o recebimento.', action: { label: 'Ver pagamento', href: `/payment/${id}` } };
    case 'checkout':
      return codeValid
        ? { ...base, state: 'checkout_code', label: '🔑 Código de checkout', tone: 'warning', priority: 4,
          detail: `Informe ao profissional. Válido até ${formatTime(context.code_expires_at!)}.`, action: { label: 'Ver checkout', href: `/checkout/${id}` } }
        : { ...base, state: 'checkout', label: '🔑 Checkout liberado', tone: 'warning', priority: 4,
          detail: 'Pagamento confirmado pelo profissional.', action: { label: 'Gerar código de checkout', href: `/checkout/${id}` } };
    case 'checkin':
      if (context.has_code) {
        return { ...base, state: 'checkin_code', label: '🔑 Código de check-in disponível', tone: 'warning', priority: 5,
          detail: 'Digite o código apresentado pelo profissional.', action: { label: 'Confirmar chegada', href: `/checkin/${id}` } };
      }
      return { ...base, state: 'waiting', label: '🕒 Aguardando início', tone: 'neutral', priority: 7,
        detail: startsAt > now ? `Começa em ${countdown(startsAt, now)}` : 'Aguardando o check-in do profissional.',
        action: { label: 'Ver operação', href: `/checkin/${id}` } };
    case 'absence_pending':
      return { ...base, state: 'checkin_late', label: context.has_code ? '🔑 Código de check-in disponível' : '⚠ Check-in não realizado', tone: 'danger', priority: 5,
        detail: context.has_code ? 'Digite o código apresentado pelo profissional.' : 'Confira a chegada do profissional.',
        action: { label: 'Conferir chegada', href: `/checkin/${id}` } };
    case 'working':
      return { ...base, state: 'working', label: '🟢 Em operação', tone: 'success', priority: 6, detail: checkedIn, action: { label: 'Ver operação', href: `/checkin/${id}` } };
    case 'absent':
      return { ...base, state: 'absent', label: '⚠ Ausência reportada', tone: 'danger', priority: 9, action: { label: 'Ver ocorrência', href: `/checkin/${id}` } };
    case 'abandoned':
      return { ...base, state: 'abandoned', label: '⚠ Abandono reportado', tone: 'danger', priority: 9, detail: checkedIn, action: { label: 'Ver ocorrência', href: `/checkin/${id}` } };
    default: {
      const soon = startsAt.getTime() - now.getTime() < DAY;
      return soon
        ? { ...base, state: 'waiting', label: '🕒 Aguardando início', tone: 'neutral', priority: 7, detail: `Começa em ${countdown(startsAt, now)}`, action: { label: 'Ver operação', href: `/checkin/${id}` } }
        : { ...base, state: 'future', label: '🕒 Futuro', tone: 'neutral', priority: 8, action: null };
    }
  }
}

export function sortTeam(hires: TeamHire[]) {
  return [...hires].sort((a, b) => a.priority - b.priority
    || Date.parse(a.context.starts_at) - Date.parse(b.context.starts_at)
    || a.context.job_id.localeCompare(b.context.job_id));
}

export type TimelineStatus = 'done' | 'current' | 'pending' | 'incident';

export function hireTimeline(hire: TeamHire, now = new Date()): Array<{ label: string; status: TimelineStatus }> {
  const { context, state } = hire;
  const ended = new Date(context.ends_at) <= now;
  const incident = state === 'absent' || state === 'abandoned';
  const steps: Array<[string, boolean]> = [
    ['Contratado', true],
    ['Check-in', Boolean(context.checkin_at)],
    ['Em operação', Boolean(context.checkin_at) && (ended || ['payment', 'receipt', 'checkout', 'checkout_code', 'review', 'completed'].includes(state))],
    ['Pagamento', Boolean(context.receipt_confirmed_at)],
    ['Checkout', Boolean(context.checkout_at)],
    ['Avaliação', state === 'completed'],
  ];
  let currentAssigned = false;
  return steps.map(([label, done]) => {
    if (done) return { label, status: 'done' as const };
    if (!currentAssigned) {
      currentAssigned = true;
      return { label, status: incident ? 'incident' as const : 'current' as const };
    }
    return { label, status: 'pending' as const };
  });
}

/** Active hires stay in Equipe until checkout and the restaurant review; incidents stay for 24 hours. */
export function isActiveAssignment(assignment: AssignmentRow, pendingReviewJobs: Set<string>, now = new Date()) {
  if (assignment.interruption === 'cancelled') return false;
  if (assignment.interruption) {
    return Boolean(assignment.interrupted_at) && now.getTime() - Date.parse(assignment.interrupted_at!) < INCIDENT_VISIBILITY;
  }
  if (assignment.checkout_at) return pendingReviewJobs.has(assignment.job_id);
  return true;
}

export async function loadRestaurantTeam(client: SupabaseClient, restaurantId: string, now = new Date()): Promise<TeamHire[]> {
  const assignments: AssignmentRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('operational_assignments')
      .select('job_id, worker_id, checkout_at, interruption, interrupted_at')
      .eq('restaurant_id', restaurantId)
      .order('job_id')
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('O serviço não retornou as contratações.');
    assignments.push(...data as AssignmentRow[]);
    if (data.length < 500) break;
  }

  const { data: reviewData, error: reviewError } = await client.rpc('pending_operational_reviews');
  if (reviewError) throw new Error(reviewError.message);
  if (!Array.isArray(reviewData)) throw new Error('O serviço não retornou as avaliações pendentes.');
  const pendingReviewJobs = new Set((reviewData as Array<{ job_id: string }>).map((row) => row.job_id));

  const candidates = assignments.filter((assignment) => assignment.worker_id !== restaurantId
    && isActiveAssignment(assignment, pendingReviewJobs, now)
    && !assignments.some((other) => other.job_id === assignment.job_id && other.worker_id !== assignment.worker_id
      && (!other.interruption || (assignment.interruption && (other.interrupted_at ?? '') > (assignment.interrupted_at ?? '')))));
  if (!candidates.length) return [];

  const userIds = [...new Set([restaurantId, ...candidates.map((assignment) => assignment.worker_id)])];
  const roleById = new Map<string, string>();
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const { data, error } = await client.from('users').select('id, role').in('id', userIds.slice(offset, offset + 100));
    if (error) throw new Error(error.message);
    if (!data) throw new Error('O serviço não retornou os participantes das contratações.');
    for (const user of data as Array<{ id: string; role: string }>) roleById.set(user.id, user.role);
  }
  if (roleById.get(restaurantId) !== 'restaurant') return [];
  const valid = candidates.filter((assignment) => roleById.get(assignment.worker_id) === 'worker');

  const hires: TeamHire[] = [];
  for (let offset = 0; offset < valid.length; offset += 20) {
    const page = await Promise.all(valid.slice(offset, offset + 20).map(async (assignment) => {
      const { data, error } = await client.rpc('operational_context', { p_job_id: assignment.job_id });
      try {
        if (error) throw new Error(error.message);
        const context = data as OperationalContext | { error: string } | null;
        if (!context || 'error' in context || !context.job_id || !context.phase || context.role !== 'restaurant') {
          throw new Error(context && 'error' in context ? context.error : 'Operação inválida.');
        }
        return describeHire(context, now);
      } catch (contextError) {
        // An inconsistent operation must not hide the remaining hires.
        console.warn('[Equipe] Contratação inconsistente ignorada', {
          job_id: assignment.job_id,
          worker_id: assignment.worker_id,
          erro: contextError instanceof Error ? contextError.message : String(contextError),
        });
        return null;
      }
    }));
    hires.push(...page.filter((hire): hire is TeamHire => Boolean(hire)));
  }
  return sortTeam(hires.filter((hire) => hire.state !== 'completed'));
}
