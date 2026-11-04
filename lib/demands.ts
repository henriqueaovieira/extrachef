import type { SupabaseClient } from '@supabase/supabase-js';
import type { HomeJob } from '@/lib/restaurant-home';

export interface DemandJob extends HomeJob {
  demand_id: string;
  demand_revision: number;
  description: string;
  value: number;
  demand_archived_at?: string | null;
  created_at?: string;
  work_number?: string | null;
  work_neighborhood?: string | null;
  work_state?: string | null;
  work_postal_code?: string | null;
  work_latitude?: number | null;
  work_longitude?: number | null;
}
export interface DemandApplication {
  job_id: string;
  worker_id: string;
  status: string;
  created_at?: string;
}
export function recruitmentWindow(job: Pick<DemandJob, 'job_date' | 'start_time' | 'end_time' | 'created_at'>) {
  const { start } = demandWindow(job);
  const normalCutoff = new Date(start.getTime() - 5 * 60 * 60 * 1000);
  const urgent = Boolean(job.created_at && new Date(job.created_at) >= normalCutoff);
  return { cutoff: urgent ? start : normalCutoff, urgent, start };
}

export function canRecruitJob(job: Pick<DemandJob, 'job_date' | 'start_time' | 'end_time' | 'created_at' | 'status' | 'demand_archived_at' | 'recruitment_blocked'>, now = new Date()) {
  return job.status === 'open' && !job.demand_archived_at && !job.recruitment_blocked && now < recruitmentWindow(job).cutoff;
}

export function canRecruitDemand(demand: Demand, now = new Date()) {
  return demand.active && !demand.archived && !demand.running && demand.jobs.some(job => canRecruitJob(job, now));
}

export function canHireDemand(demand: Demand, now = new Date()) {
  return demand.active && !demand.archived && !demand.running
    && demand.jobs.some(job => job.status === 'open' && !job.recruitment_blocked && now < demandWindow(job).start);
}
export interface DemandReserve { demand_id: string; worker_id: string }
export interface Demand {
  id: string;
  job: DemandJob;
  jobs: DemandJob[];
  required: number;
  hired: number;
  reserve: number;
  candidates: number;
  applications: DemandApplication[];
  status: string;
  health: 'safe' | 'warning' | 'risk' | 'neutral';
  healthLabel: string;
  attention: boolean;
  active: boolean;
  running: boolean;
  completed: boolean;
  cancelled: boolean;
  canEdit: boolean;
  canCancel: boolean;
  archived: boolean;
}
export const demandFilters = [
  ['all', 'Todas'], ['today', 'Hoje'], ['hiring', 'Contratando'],
  ['running', 'Em Andamento'], ['completed', 'Concluídas'], ['cancelled', 'Canceladas'],
  ['archived', 'Arquivadas'],
] as const;
export type DemandFilter = typeof demandFilters[number][0];

export function demandWindow(job: Pick<HomeJob, 'job_date' | 'start_time' | 'end_time'>) {
  const start = new Date(`${job.job_date}T${job.start_time}-03:00`);
  const end = new Date(`${job.job_date}T${job.end_time}-03:00`);
  if (end <= start) end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export function buildDemands(jobs: DemandJob[], applications: DemandApplication[], reserves: DemandReserve[], now = new Date()): Demand[] {
  const groups = new Map<string, DemandJob[]>();
  for (const job of jobs) {
    const id = job.demand_id || job.id;
    groups.set(id, [...(groups.get(id) ?? []), job]);
  }
  return [...groups.entries()].map(([id, group]): Demand => {
    const job = group[0];
    const ids = new Set(group.map((item) => item.id));
    const assignments = applications.filter((item) => ids.has(item.job_id));
    const liveJobs = group.filter((item) => item.status !== 'cancelled');
    const confirmed = new Set(assignments.filter((item) => ['approved', 'in_progress', 'completed'].includes(item.status)).map((item) => item.worker_id));
    const liveIds = new Set(liveJobs.map((item) => item.id));
    const pending = new Set(assignments.filter((item) => item.status === 'pending' && liveIds.has(item.job_id) && !confirmed.has(item.worker_id)).map((item) => item.worker_id));
    const reserve = new Set(reserves.filter((item) => item.demand_id === id && !confirmed.has(item.worker_id)
      && assignments.some((application) => application.worker_id === item.worker_id && application.status === 'pending')).map((item) => item.worker_id)).size;
    const cancelled = liveJobs.length === 0;
    const completed = !cancelled && liveJobs.every((item) => item.status === 'completed');
    const { start, end } = demandWindow(job);
    const checkedIn = assignments.some((item) => item.status === 'in_progress');
    const hired = confirmed.size;
    const running = !cancelled && !completed && (checkedIn || (hired > 0 && start <= now && end > now));
    const active = !cancelled && !completed;
    const required = liveJobs.length || group.length;
    const shortage = Math.max(0, required - hired);
    const checkout = active && end <= now && assignments.some((item) => ['approved', 'in_progress'].includes(item.status));
    const risk = active && ((shortage > 0 && start.getTime() - now.getTime() <= 24 * 60 * 60 * 1000) || checkout);
    const health = !active ? 'neutral' : risk ? 'risk' : shortage > 0 ? 'warning' : 'safe';
    const status = cancelled ? 'Cancelada' : completed ? 'Concluída' : checkout ? 'Checkout Pendente'
      : active && (end <= now || (start <= now && hired === 0)) ? 'Não preenchida'
      : running ? 'Em Andamento' : hired >= required ? required === 1 ? 'Profissional Contratado' : 'Equipe Completa'
      : hired > 0 ? 'Equipe em formação' : !group.some((item) => canRecruitJob(item, now)) ? 'Recrutamento encerrado'
        : pending.size ? 'Recebendo Candidaturas' : 'Buscando Profissionais';
    return {
      id, job, jobs: group, required, hired, reserve, candidates: pending.size, applications: assignments,
      status, health, healthLabel: !active ? status : checkout ? 'Confira o encerramento da operação'
        : risk ? `Operação em risco · ${shortage} ${shortage === 1 ? 'profissional pendente' : 'profissionais pendentes'}`
        : shortage ? `${shortage === 1 ? 'Falta' : 'Faltam'} ${shortage} ${shortage === 1 ? 'profissional' : 'profissionais'}`
        : 'Equipe contratada',
      attention: active && (shortage > 0 || pending.size > 0 || checkout),
      active, running, completed, cancelled,
      archived: group.some((item) => Boolean(item.demand_archived_at)),
      canEdit: group.every((item) => item.status === 'open') && start > now && assignments.length === 0 && !group.some((item) => item.demand_archived_at),
      canCancel: active && group.every((item) => ['open', 'cancelled'].includes(item.status)),
    };
  }).sort((a, b) => Number(b.active) - Number(a.active)
    || (a.active ? 1 : -1) * (demandWindow(a.job).start.getTime() - demandWindow(b.job).start.getTime()));
}

export function filterDemands(demands: Demand[], filter: DemandFilter, now = new Date()) {
  return demands.filter((demand) => {
    if (filter === 'archived') return demand.archived;
    if (demand.archived) return false;
    switch (filter) {
      case 'today': return !demand.cancelled && (new Date(`${demand.job.job_date}T12:00:00`).toDateString() === now.toDateString() || demand.running);
      case 'hiring': return canRecruitDemand(demand, now);
      case 'running': return demand.running;
      case 'completed': return demand.completed;
      case 'cancelled': return demand.cancelled;
      default: return true;
    }
  });
}

export function demandDate(date: string, now = new Date()) {
  const day = new Date(`${date}T12:00:00`);
  if (day.toDateString() === now.toDateString()) return 'Hoje';
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day.toDateString() === tomorrow.toDateString()) return 'Amanhã';
  return day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}

export async function readDemandPages<T>(read: (offset: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await read(offset);
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('O serviço não retornou os dados da operação.');
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
}

export async function loadDemands(client: SupabaseClient, demandId?: string) {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw new Error('Entre na conta da empresa para continuar.');
  const userId = auth.data.user.id;
  const jobs = await readDemandPages<DemandJob>((offset) => {
    let query = client.from('jobs').select('id, demand_id, demand_revision, demand_archived_at, created_at, recruitment_blocked, title, description, value, job_date, start_time, end_time, status, location_name, work_address, work_number, work_neighborhood, work_city, work_state, work_postal_code, work_latitude, work_longitude')
      .eq('restaurant_id', userId).order('id');
    if (demandId) query = query.eq('demand_id', demandId);
    return query.range(offset, offset + 499);
  });
  const applications: DemandApplication[] = [];
  const reserves: DemandReserve[] = [];
  for (let offset = 0; offset < jobs.length; offset += 100) {
    const ids = jobs.slice(offset, offset + 100).map((job) => job.id);
    applications.push(...await readDemandPages<DemandApplication>((page) => client.from('applications')
      .select('job_id, worker_id, status, created_at').in('job_id', ids).order('job_id').order('worker_id').range(page, page + 499)));
  }
  const demandIds = [...new Set(jobs.map((job) => job.demand_id))];
  for (let offset = 0; offset < demandIds.length; offset += 100) {
    reserves.push(...await readDemandPages<DemandReserve>((page) => client.from('demand_reserves').select('demand_id, worker_id')
      .eq('restaurant_id', userId).in('demand_id', demandIds.slice(offset, offset + 100))
      .order('demand_id').order('worker_id').range(page, page + 499)));
  }
  return { jobs, applications, reserves };
}
