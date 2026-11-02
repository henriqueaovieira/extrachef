import type { SupabaseClient } from '@supabase/supabase-js';

export interface OperationalContext {
  job_id: string;
  demand_id: string;
  title: string;
  location: string;
  starts_at: string;
  ends_at: string;
  role: 'worker' | 'restaurant';
  worker_name: string;
  phase: string;
  amount: number;
  checkin_at: string | null;
  paid_at: string | null;
  receipt_confirmed_at: string | null;
  checkout_at: string | null;
  code: string | null;
  code_expires_at: string | null;
  has_code: boolean;
  review_pending: boolean;
}

export interface OperationalAssignment {
  job_id: string;
  worker_id: string;
  checkin_at: string | null;
  paid_at: string | null;
  receipt_confirmed_at: string | null;
  checkout_at: string | null;
  interruption: string | null;
  interrupted_at: string | null;
  replacement_job_id: string | null;
}

export interface PendingReview { job_id: string; title: string; reviewed_name: string }

export interface OperationalReputation {
  score: number;
  classification: string;
  punctuality: number | null;
  average_rating: number | null;
  completed: number;
  rehires: number;
  checkins: number;
  checkouts: number;
  early: number;
  on_time: number;
  late: number;
  absences: number;
  cancellations_90d: number;
  abandonments_180d: number;
}

export const phaseLabels: Record<string, string> = {
  confirmed: 'Você está confirmado para esta operação.',
  checkin: 'Aguardando Check-in',
  absence_pending: 'Aguardando confirmação de ausência',
  working: 'Trabalho em andamento',
  payment: 'Trabalho encerrado',
  receipt: 'Aguardando confirmação de recebimento',
  payment_disputed: 'Pagamento não recebido',
  checkout: 'Pagamento confirmado',
  completed: 'Trabalho concluído com sucesso.',
  cancelled: 'Contratação cancelada',
  absent: 'Ausência confirmada',
  abandoned: 'Abandono registrado',
};

export function operationNextAction(
  assignment: OperationalAssignment,
  startsAt: Date,
  endsAt: Date,
  role: 'restaurant' | 'worker',
  now = new Date(),
) {
  const id = assignment.job_id;
  if (assignment.interruption) return { label: 'Ver ocorrência', href: `/checkin/${id}` };
  if (assignment.checkout_at) return { label: 'Ver conclusão', href: `/checkout/${id}` };
  if (!assignment.checkin_at) return {
    label: now < startsAt ? 'Ver confirmação' : now.getTime() > startsAt.getTime() + 300_000 ? 'Conferir chegada' : role === 'restaurant' ? 'Confirmar Check-in' : 'Realizar Check-in',
    href: `/checkin/${id}`,
  };
  if (now < endsAt) return { label: 'Trabalho em andamento', href: `/checkin/${id}` };
  if (assignment.receipt_confirmed_at) return { label: 'Realizar Checkout', href: `/checkout/${id}` };
  return {
    label: role === 'restaurant' ? assignment.paid_at ? 'Conferir recebimento' : 'Confirmar Pagamento' : assignment.paid_at ? 'Confirmar recebimento' : 'Aguardando pagamento',
    href: `/payment/${id}`,
  };
}

export async function loadPendingReviews(client: SupabaseClient): Promise<PendingReview[]> {
  const { data, error } = await client.rpc('pending_operational_reviews');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('O serviço não retornou as avaliações pendentes.');
  return data;
}

export async function loadOperationalAssignments(client: SupabaseClient, jobIds?: string[]): Promise<OperationalAssignment[]> {
  const rows: OperationalAssignment[] = [];
  const groups = jobIds ? Array.from({ length: Math.ceil(jobIds.length / 100) }, (_, index) => jobIds.slice(index * 100, index * 100 + 100)) : [undefined];
  for (const ids of groups) {
    for (let offset = 0; ; offset += 500) {
      let query = client.from('operational_assignments')
        .select('job_id, worker_id, checkin_at, paid_at, receipt_confirmed_at, checkout_at, interruption, interrupted_at, replacement_job_id').order('job_id');
      if (ids) query = query.in('job_id', ids);
      const { data, error } = await query.range(offset, offset + 499);
      if (error) throw new Error(error.message);
      if (!data) throw new Error('O serviço não retornou as etapas operacionais.');
      rows.push(...data);
      if (data.length < 500) break;
    }
  }
  return rows;
}

export function readOperationalContext(data: OperationalContext | { error: string } | null): OperationalContext {
  if (!data) throw new Error('O serviço não retornou a operação.');
  if ('error' in data) throw new Error(data.error);
  if (!data.job_id || !data.phase || !['worker', 'restaurant'].includes(data.role)) {
    throw new Error('O serviço retornou uma operação inválida.');
  }
  return data;
}
