import { demandWindow } from '@/lib/demands';

export interface HomeJob {
  id: string;
  demand_id?: string;
  title: string;
  job_date: string;
  start_time: string;
  end_time: string;
  status: string;
  location_name: string | null;
  work_address: string | null;
  work_number?: string | null;
  work_city: string | null;
  work_state?: string | null;
  value?: number | string | null;
  created_at?: string;
  demand_archived_at?: string | null;
  recruitment_blocked?: boolean;
  location_status?: string;
  work_latitude?: number | null;
  work_longitude?: number | null;
}

export function groupHomeJobs(jobs: HomeJob[]) {
  const groups = new Map<string, HomeJob[]>();
  for (const job of jobs) {
    const id = job.demand_id || job.id;
    groups.set(id, [...(groups.get(id) ?? []), job]);
  }
  return groups;
}

export const jobStatusLabels: Record<string, string> = {
  open: 'Buscando profissional',
  filled: 'Equipe confirmada',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export function isUpcomingJob(job: HomeJob, now = new Date()) {
  if (!['open', 'filled', 'in_progress'].includes(job.status)) return false;
  return demandWindow(job).end > now;
}

export function nextDemand(jobs: HomeJob[], now = new Date()) {
  return jobs.filter((job) => isUpcomingJob(job, now))
    .sort((a, b) => `${a.job_date}${a.start_time}`.localeCompare(`${b.job_date}${b.start_time}`))[0];
}

export function latestMessagesByJob<T extends { job_id: string; created_at: string }>(messages: T[]) {
  const latest = new Map<string, T>();
  for (const message of messages) {
    const previous = latest.get(message.job_id);
    if (!previous || message.created_at > previous.created_at) latest.set(message.job_id, message);
  }
  return new Map([...latest.entries()].sort((a, b) => b[1].created_at.localeCompare(a[1].created_at)));
}
