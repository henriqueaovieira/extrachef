import type { SupabaseClient } from '@supabase/supabase-js';

export interface OperationalContext {
  assignment_id?: string;
  worker_id?: string;
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
  id?: string;
  job_id: string;
  worker_id: string;
  checkin_at: string | null;
  paid_at: string | null;
  payment_disputed_at?: string | null;
  receipt_confirmed_at: string | null;
  checkout_at: string | null;
  interruption: string | null;
  interrupted_at: string | null;
  replacement_job_id: string | null;
  replacement_requested_at?: string | null;
  replacement_closed_at?: string | null;
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

export interface OperationFlowInput {
  jobId: string;
  role: 'restaurant' | 'worker';
  hired: boolean;
  assignment: Pick<OperationalAssignment, 'checkin_at' | 'paid_at' | 'receipt_confirmed_at' | 'checkout_at'> & {
    interruption?: string | null; payment_disputed_at?: string | null;
  } | null;
  endsAt: Date;
  startsAt?: Date;
  now: Date;
  phase?: string;
}

export function getOperationFlow({ jobId, role, hired, assignment, startsAt, endsAt, now, phase }: OperationFlowInput) {
  const interrupted = assignment?.interruption || (phase && ['cancelled', 'absent', 'abandoned'].includes(phase) ? phase : null);
  const known = hired && assignment !== null;
  const checkedIn = known && Boolean(assignment.checkin_at);
  const received = checkedIn && Boolean(assignment.receipt_confirmed_at);
  const completed = received && Boolean(assignment.checkout_at);
  const disputed = phase === 'payment_disputed' || Boolean(assignment?.payment_disputed_at);
  const ended = Number.isFinite(endsAt.getTime()) && now >= endsAt;
  const current = !hired ? 1 : !known ? -1 : !checkedIn ? 2 : !received ? 3 : !completed ? 4 : 5;
  const paymentReady = checkedIn && ended;
  const status = interrupted ? phaseLabels[interrupted] ?? 'Operação interrompida'
    : !hired ? 'Aguardando contratação'
      : !known ? 'Estado operacional indisponível. Atualize a operação para conferir as etapas.'
        : completed ? phaseLabels.completed
          : !checkedIn ? phase === 'confirmed' ? phaseLabels.confirmed : phaseLabels.checkin
            : !ended ? phaseLabels.working
              : received ? 'Recebimento confirmado. Checkout liberado.'
                : disputed ? phaseLabels.payment_disputed
                  : assignment.paid_at ? phaseLabels.receipt : 'Aguardando pagamento';
  const descriptions = [
    'Operação publicada.',
    hired ? 'Contratação confirmada.' : role === 'restaurant' ? 'Contrate um profissional para iniciar.' : 'Aguarde a confirmação do restaurante.',
    checkedIn ? 'Chegada confirmada.' : 'Disponível após a contratação, conforme o horário da operação.',
    received ? 'Recebimento confirmado pelo profissional.'
      : !checkedIn ? 'Disponível após o check-in e o encerramento do horário.'
        : !ended ? 'Aguarde o encerramento do horário da operação.'
          : disputed ? role === 'restaurant' ? 'O profissional informou que não recebeu. Confira e regularize o pagamento.' : 'Pagamento não recebido. Aguarde a regularização pelo restaurante.'
            : assignment?.paid_at ? role === 'worker' ? 'Confira o recebimento antes de confirmar.' : 'Aguarde o profissional confirmar o recebimento.'
            : role === 'restaurant' ? 'Pague fora do aplicativo e registre o pagamento.' : 'Aguarde o restaurante informar o pagamento.',
    completed ? 'Saída confirmada.' : 'Disponível após o profissional confirmar o recebimento.',
    completed ? 'Operação concluída.' : 'Disponível após validar o checkout.',
  ];
  const steps = ['Operação', 'Contratação', 'Check-in', 'Pagamento', 'Checkout', 'Conclusão'].map((label, index): {
    label: string; description: string; state: 'done' | 'current' | 'locked';
  } => ({
    label,
    description: descriptions[index],
    state: (index === 0 || (index === 1 && hired) || (index === 2 && checkedIn) || (index === 3 && received) || (index >= 4 && completed)
      ? 'done' : !interrupted && index === current ? 'current' : 'locked'),
  }));
  const action = !known || interrupted ? null
    : completed ? { label: 'Ver conclusão', href: `/checkout/${jobId}` }
      : received && ended ? { label: role === 'worker' ? 'Realizar Checkout' : 'Gerar código de Checkout', href: `/checkout/${jobId}` }
        : paymentReady ? { label: role === 'restaurant' ? assignment.paid_at && !disputed ? 'Conferir recebimento' : 'Confirmar Pagamento'
          : assignment.paid_at ? 'Confirmar recebimento' : 'Acompanhar pagamento', href: `/payment/${jobId}` }
          : { label: checkedIn ? 'Acompanhar operação' : phase === 'confirmed' || (startsAt && now < startsAt) ? 'Ver confirmação'
            : role === 'restaurant' ? 'Confirmar Check-in' : 'Realizar Check-in', href: `/checkin/${jobId}` };
  return { steps, status, action, chatHref: hired && !interrupted ? `/chat/${jobId}` : null };
}

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
        .select('id, job_id, worker_id, checkin_at, paid_at, payment_disputed_at, receipt_confirmed_at, checkout_at, interruption, interrupted_at, replacement_job_id, replacement_requested_at, replacement_closed_at').order('job_id').order('id');
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
