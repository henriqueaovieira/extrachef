import type { SupabaseClient } from '@supabase/supabase-js';
import type { Demand } from '@/lib/demands';

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
  location_precision?: 'house' | 'street' | 'device' | null;
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

export interface WorkerHomeOperation extends OperationalAssignment {
  job: {
    title: string;
    job_date: string;
    start_time: string;
    end_time: string;
    restaurant?: { name: string } | null;
  };
}

export interface WorkerHomeOperationCard {
  jobId: string;
  title: string;
  role: string;
  restaurant: string;
  schedule: string;
  status: string;
  action: string;
  href: string;
  priority: number;
  urgency: number;
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

export interface OperationCoreInput {
  demand: Demand;
  assignments: OperationalAssignment[];
  windows: ReadonlyMap<string, { start: Date; end: Date }>;
  now: Date;
  canHire: boolean;
  canRecruit: boolean;
  unavailable?: boolean;
  reviews?: PendingReview[];
}

export type OperationPresence = 'present' | 'late' | 'pending' | 'absent' | 'finished' | 'interrupted';

export function getOperationSummary(input: OperationCoreInput) {
  const { demand, windows, now } = input;
  const jobIds = new Set(demand.jobs.map((job) => job.id));
  const unique = new Map<string, OperationalAssignment>();
  let conflicting = false;
  for (const assignment of input.assignments) {
    if (!jobIds.has(assignment.job_id)) continue;
    const key = `${assignment.job_id}:${assignment.worker_id}`;
    const previous = unique.get(key);
    if (previous && (['id', 'checkin_at', 'paid_at', 'receipt_confirmed_at', 'checkout_at', 'interruption',
      'payment_disputed_at', 'interrupted_at', 'replacement_job_id', 'replacement_requested_at', 'replacement_closed_at'] as const).some(
      (field) => previous[field] !== assignment[field],
    )) conflicting = true;
    unique.set(key, assignment);
  }
  const participants = [...unique.values()].sort((a, b) => a.job_id.localeCompare(b.job_id)
    || a.worker_id.localeCompare(b.worker_id)).map((assignment) => {
    const window = windows.get(assignment.job_id);
    const late = Boolean(assignment.checkin_at && window
      && Date.parse(assignment.checkin_at) > window.start.getTime() + 300_000);
    const presence: OperationPresence = assignment.checkout_at ? 'finished'
      : assignment.interruption === 'absent' ? 'absent'
        : assignment.interruption || demand.jobs.some((job) => job.id === assignment.job_id && job.status === 'cancelled') ? 'interrupted'
          : assignment.checkin_at ? late ? 'late' : 'present' : 'pending';
    return { assignment, presence, late };
  });
  const current = participants.filter(({ assignment }) => !assignment.interruption
    && demand.jobs.some((job) => job.id === assignment.job_id && job.status !== 'cancelled'));
  const missing = demand.applications.some((application) => ['approved', 'in_progress', 'completed'].includes(application.status)
    && !unique.has(`${application.job_id}:${application.worker_id}`));
  const available = !input.unavailable && !missing && !conflicting && Number.isFinite(now.getTime())
    && participants.every(({ assignment }) => [
      assignment.checkin_at, assignment.paid_at, assignment.receipt_confirmed_at, assignment.checkout_at,
      assignment.payment_disputed_at, assignment.interrupted_at,
    ].every((value) => !value || Number.isFinite(Date.parse(value))))
    && demand.jobs.every((job) => {
      const window = windows.get(job.id);
      return window && Number.isFinite(window.start.getTime()) && Number.isFinite(window.end.getTime());
    }) && new Set(current.map(({ assignment }) => assignment.job_id)).size === current.length;
  const financial = current.filter(({ assignment }) => {
    const window = windows.get(assignment.job_id);
    return window && assignment.checkin_at && now >= window.end
      && (!assignment.receipt_confirmed_at || assignment.payment_disputed_at);
  }).sort((a, b) => Number(!b.assignment.paid_at || Boolean(b.assignment.payment_disputed_at))
    - Number(!a.assignment.paid_at || Boolean(a.assignment.payment_disputed_at)));
  const checkout = current.filter(({ assignment }) => {
    const window = windows.get(assignment.job_id);
    return window && assignment.checkin_at && !assignment.checkout_at && now >= window.end;
  });
  const checkin = current.filter(({ assignment }) => {
    const window = windows.get(assignment.job_id);
    return window && !assignment.checkin_at && now >= window.start;
  });
  const working = current.filter(({ assignment }) => {
    const window = windows.get(assignment.job_id);
    return window && assignment.checkin_at && !assignment.checkout_at && now < window.end;
  });
  return {
    available, participants, current, financial, checkout, checkin, working,
    confirmed: current.length,
    present: current.filter(({ assignment }) => assignment.checkin_at && !assignment.checkout_at).length,
    arrivalsPending: checkin.filter(({ assignment }) => {
      const window = windows.get(assignment.job_id);
      return window && now.getTime() > window.start.getTime() + 300_000;
    }).length,
    absences: participants.filter(({ presence }) => presence === 'absent').length,
    checkouts: participants.filter(({ presence }) => presence === 'finished').length,
    shortage: Math.max(0, demand.required - current.length),
  };
}

export function getOperationState(input: OperationCoreInput) {
  const summary = getOperationSummary(input);
  if (!summary.available || input.demand.cancelled) return null;
  if (summary.current.every(({ assignment }) => Boolean(assignment.checkout_at))
    && (input.demand.completed || (!summary.shortage && summary.current.length > 0))) return 'Finalizada';
  if (summary.financial.length) return 'Financeiro';
  if (summary.checkout.length) return 'Encerramento';
  if (summary.working.length) return 'Em andamento';
  if (summary.shortage || summary.checkin.length) return 'Preparação';
  return 'Planejada';
}

export function getOperationContinuation(input: OperationCoreInput): {
  kind: 'unavailable' | 'cancelled' | 'completed' | 'financial' | 'checkout' | 'checkin' | 'incident' | 'hiring' | 'candidates' | 'working';
  label: string; description: string; responsible: string; nextStep: string;
  count: number; action: { label: string; href: string } | null;
} {
  const summary = getOperationSummary(input);
  const base = `/restaurant/demands/${input.demand.id}`;
  if (!summary.available) return {
    kind: 'unavailable', label: 'Atualizar operação', count: 0,
    description: 'Estado operacional indisponível. Atualize os dados antes de agir.',
    nextStep: 'Recarregue os vínculos para identificar a próxima etapa com segurança.',
    responsible: 'Restaurante · conferir os dados', action: null,
  };
  if (input.demand.cancelled) return {
    kind: 'cancelled', label: 'Consultar encerramento', count: 0,
    description: 'Operação cancelada. O histórico e as ocorrências foram preservados.',
    nextStep: 'Consulte o histórico sem reiniciar os fluxos desta operação.',
    responsible: 'Restaurante · consultar histórico', action: { label: 'Ver histórico', href: `${base}#timeline-heading` },
  };
  if (getOperationState(input) === 'Finalizada') {
    const review = input.reviews?.find((item) => input.demand.jobs.some((job) => job.id === item.job_id));
    return {
      kind: 'completed', label: 'Encerrar acompanhamento', count: 0,
      description: review ? 'Operação concluída. Avaliação pendente do restaurante.' : 'Participantes finalizados. Consulte o histórico da operação.',
      nextStep: review ? 'Registre a avaliação pendente para encerrar o acompanhamento.' : 'Acompanhe a conclusão no histórico, sem novas ações operacionais.',
      responsible: review ? 'Restaurante · avaliar profissional' : 'Restaurante · consultar conclusão',
      action: review ? { label: 'Avaliar experiência', href: `/reviews/${review.job_id}` }
        : { label: 'Ver conclusão', href: `${base}#timeline-heading` },
    };
  }
  const pending = summary.financial.length ? summary.financial : summary.checkout.length ? summary.checkout : summary.checkin;
  if (pending.length) {
    const assignment = pending[0].assignment;
    const window = input.windows.get(assignment.job_id);
    if (!window) throw new Error('Horário da operação indisponível.');
    const flow = getOperationFlow({
      jobId: assignment.job_id, role: 'restaurant', hired: true, assignment,
      startsAt: window.start, endsAt: window.end, now: input.now,
    });
    const financial = summary.financial.length > 0;
    const checkout = !financial && summary.checkout.length > 0;
    const next = operationNextAction(assignment, window.start, window.end, 'restaurant', input.now);
    return {
      kind: financial ? 'financial' : checkout ? 'checkout' : 'checkin',
      label: financial ? 'Regularizar pagamentos' : checkout ? 'Finalizar participantes' : 'Realizar check-ins',
      count: pending.length,
      nextStep: financial ? 'Após a confirmação do recebimento, confira os check-outs pendentes.'
        : checkout ? 'Após os check-outs, consulte a conclusão e as avaliações.'
          : 'Com as chegadas confirmadas, acompanhe a execução até o fim da agenda.',
      description: financial ? `${pending.length} profissional(is) com pagamento ou recebimento pendente. ${flow.status}`
        : checkout ? `${pending.length} profissional(is) aguardando checkout. ${flow.status}`
          : `${pending.length} profissional(is) aguardando check-in. Atraso não confirma ausência.`,
      responsible: financial ? assignment.paid_at && !assignment.payment_disputed_at
        ? 'Profissional confirma recebimento; restaurante acompanha' : assignment.payment_disputed_at
          ? 'Restaurante · regularizar pagamento' : 'Restaurante · confirmar pagamento'
        : checkout ? 'Restaurante gera código; profissional realiza checkout'
          : 'Profissional apresenta código; restaurante confirma check-in',
      action: financial ? flow.action : { ...next, label: checkout ? 'Gerar código de Checkout' : next.label },
    };
  }
  const incident = summary.participants.find(({ assignment }) => assignment.interruption
    && !assignment.replacement_closed_at && !summary.current.some((item) => item.assignment.job_id === assignment.job_id));
  if (incident) return {
    kind: 'incident', label: 'Decidir sobre a ocorrência', count: 1,
    description: 'Confira o encerramento ou a substituição pelos candidatos já vinculados. O recrutamento não foi reaberto.',
    nextStep: 'Resolva a ocorrência antes de retomar o acompanhamento da vaga.',
    responsible: 'Restaurante · conferir ocorrência', action: { label: 'Conferir ocorrência', href: `${base}#reserve-heading` },
  };
  if (summary.shortage && (input.canHire || input.canRecruit || !summary.working.length)) return {
    kind: 'hiring', label: !input.canHire && !input.canRecruit ? 'Contratação indisponível nesta etapa'
      : summary.confirmed ? 'Completar equipe' : 'Contratar profissionais', count: summary.shortage,
    description: input.canHire ? `Faltam ${summary.shortage} profissional(is) para completar a equipe.`
      : 'Contratação indisponível nesta janela. Confira a equipe e o histórico.',
    nextStep: input.canHire || input.canRecruit ? 'Com a equipe confirmada, acompanhe os check-ins no início da agenda.'
      : 'Confira a ocorrência ou o histórico, sem reabrir a contratação.',
    responsible: 'Restaurante · acompanhar contratação',
    action: input.canHire && input.demand.candidates ? { label: 'Analisar candidatos', href: `${base}?view=candidates` }
      : input.canRecruit ? { label: 'Convidar profissionais', href: `${base}?view=talents` }
        : { label: 'Conferir equipe', href: `${base}#team-heading` },
  };
  if (input.demand.candidates && input.canHire) return {
    kind: 'candidates', label: 'Analisar candidatos', count: input.demand.candidates,
    description: `${input.demand.candidates} candidatura(s) aguardando análise.`,
    nextStep: 'Confirme a contratação somente após avaliar a candidatura e a elegibilidade.',
    responsible: 'Restaurante · analisar candidaturas', action: { label: 'Analisar candidatos', href: `${base}?view=candidates` },
  };
  return {
    kind: 'working', label: 'Acompanhar operação', count: summary.working.length,
    description: summary.working.length ? 'Trabalho em andamento. A próxima etapa será conferida ao término do horário.'
      : 'Equipe confirmada. Acompanhe a agenda e o início dos check-ins.',
    nextStep: summary.working.length ? 'No término da agenda, confira pagamento, recebimento e checkout de cada participante.'
      : 'No início da agenda, acompanhe as chegadas e os check-ins.',
    responsible: 'Restaurante e profissional · acompanhar operação',
    action: { label: 'Acompanhar etapas', href: `${base}#operation-flow-heading` },
  };
}

export function selectWorkerHomeOperation(operations: WorkerHomeOperation[], now = new Date()): WorkerHomeOperationCard | null {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
  const tomorrowDate = new Date(`${today}T12:00:00-03:00`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(tomorrowDate);
  const candidates: WorkerHomeOperationCard[] = [];

  for (const operation of operations) {
    if (operation.interruption || operation.replacement_job_id || operation.checkout_at) continue;

    const start = new Date(`${operation.job.job_date}T${operation.job.start_time}-03:00`);
    const end = new Date(`${operation.job.job_date}T${operation.job.end_time}-03:00`);
    if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
    let priority: number;
    let heading: string;
    let status: string;
    let action: string;
    let href: string;
    let urgency: number;

    if (operation.receipt_confirmed_at) {
      priority = 1;
      heading = 'Checkout Disponível';
      status = '⏰ Checkout disponível';
      action = 'Realizar Checkout';
      href = `/checkout/${operation.job_id}`;
      urgency = end.getTime();
    } else if (operation.checkin_at && now < end) {
      priority = 4;
      heading = 'Operação em Andamento';
      status = '✅ Operação em andamento';
      action = 'Continuar Operação';
      href = `/checkin/${operation.job_id}`;
      urgency = end.getTime();
    } else if (operation.checkin_at) {
      priority = 3;
      heading = 'Pendência Operacional';
      status = '⚠️ Ação necessária';
      action = 'Resolver Pendência';
      href = `/payment/${operation.job_id}`;
      urgency = end.getTime();
    } else if (now.getTime() >= start.getTime() + 5 * 60_000) {
      priority = 3;
      heading = 'Pendência Operacional';
      status = '⚠️ Ação necessária';
      action = 'Resolver Pendência';
      href = `/checkin/${operation.job_id}`;
      urgency = start.getTime();
    } else if (now.getTime() >= start.getTime()) {
      priority = 2;
      heading = 'Check-in Disponível';
      status = '📍 Check-in disponível';
      action = 'Realizar Check-in';
      href = `/checkin/${operation.job_id}`;
      urgency = start.getTime();
    } else {
      priority = 5;
      heading = 'Próxima Operação';
      const minutes = Math.max(0, Math.floor((start.getTime() - now.getTime()) / 60_000));
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      status = `🕐 Começa em ${hours ? `${hours}h${String(remainder).padStart(2, '0')}` : `${remainder}min`}`;
      action = 'Ver Operação';
      href = `/checkin/${operation.job_id}`;
      urgency = start.getTime();
    }

    const dateLabel = operation.job.job_date === today ? 'Hoje'
      : operation.job.job_date === tomorrow ? 'Amanhã'
        : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
          .format(start);
    candidates.push({
      jobId: operation.job_id,
      title: heading,
      role: operation.job.title,
      restaurant: operation.job.restaurant?.name || 'Estabelecimento',
      schedule: `${dateLabel} • ${operation.job.start_time.slice(0, 5)} às ${operation.job.end_time.slice(0, 5)}`,
      status,
      action,
      href,
      priority,
      urgency,
    });
  }

  return candidates.sort((a, b) => a.priority - b.priority || a.urgency - b.urgency)[0] ?? null;
}

export async function loadWorkerHomeOperations(client: SupabaseClient, workerId: string): Promise<WorkerHomeOperation[]> {
  const assignments = (await loadOperationalAssignments(client)).filter((assignment) => assignment.worker_id === workerId);
  if (!assignments.length) return [];

  const { data, error } = await client.from('jobs')
    .select('id, title, job_date, start_time, end_time, restaurant:users!restaurant_id(name)')
    .in('id', assignments.map((assignment) => assignment.job_id));
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('O serviço não retornou os dados das operações.');

  const jobs = new Map((data as Array<{
    id: string;
    title: string;
    job_date: string;
    start_time: string;
    end_time: string;
    restaurant: { name: string } | { name: string }[] | null;
  }>).map((job) => [job.id, {
    title: job.title,
    job_date: job.job_date,
    start_time: job.start_time,
    end_time: job.end_time,
    restaurant: Array.isArray(job.restaurant) ? job.restaurant[0] ?? null : job.restaurant,
  }]));
  if (jobs.size !== new Set(assignments.map((assignment) => assignment.job_id)).size) {
    throw new Error('O serviço não retornou todas as operações confirmadas.');
  }
  return assignments.flatMap((assignment) => {
    const job = jobs.get(assignment.job_id);
    return job ? [{ ...assignment, job }] : [];
  });
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
