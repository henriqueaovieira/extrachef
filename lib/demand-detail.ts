import type { SupabaseClient } from '@supabase/supabase-js';
import { demandDate, type Demand, type DemandApplication } from '@/lib/demands';
import type { OperationalReputation } from '@/lib/operations';

export interface DemandPerson {
  id: string;
  name: string;
  specialties: string[] | null;
  score: number | null;
  photo_path: string | null;
  photoUrl?: string | null;
  experience: string | null;
  categories: string[];
  completed_operations: number;
  invitation_status: string | null;
  reputation?: OperationalReputation | null;
}
export interface DemandEvent {
  id: string;
  kind: string;
  worker_id: string | null;
  occurred_at: string;
}
export const eventLabels: Record<string, string> = {
  created: 'Demanda criada', edited: 'Demanda atualizada', cancelled: 'Demanda cancelada',
  archived: 'Demanda arquivada', restored: 'Demanda restaurada',
  invitation_sent: 'Convite enviado', invitation_accepted: 'Convite aceito',
  invitation_declined: 'Convite recusado', candidate_received: 'Candidato recebido',
  hired: 'Profissional contratado', worker_cancelled: 'Profissional cancelou',
  reserve_added: 'Reserva adicionada', reserve_removed: 'Reserva removida',
  checkin: 'Check-in realizado', checkout: 'Checkout realizado', review: 'Avaliação concluída',
  early: 'Chegada antecipada', on_time: 'Chegada pontual', late: 'Atraso registrado',
  absent: 'Ausência confirmada', abandoned: 'Abandono registrado', position_reopened: 'Posição reaberta',
  seek_replacement: 'Restaurante decidiu buscar substituto', close_interrupted: 'Operação encerrada após ocorrência',
  replacement_invited: 'Convite de substituição enviado', replacement_accepted: 'Reserva disponível · aguardando confirmação do restaurante',
  payment_reported: 'Pagamento informado pela empresa', payment_confirmed: 'Pagamento confirmado pelo profissional',
  payment_disputed: 'Profissional informou não recebimento', work_ended: 'Trabalho encerrado pelo horário',
  absence_pending: 'Ausência aguardando confirmação', commitment_reminder: 'Lembrete de compromisso enviado',
};

export function uniqueDemandCandidates(demand: Demand) {
  const hired = new Set(demand.applications.filter((item) => ['approved', 'in_progress', 'completed'].includes(item.status)).map((item) => item.worker_id));
  const candidates = new Map<string, DemandApplication>();
  for (const item of [...demand.applications].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))) {
    if (item.status === 'pending' && !hired.has(item.worker_id) && !candidates.has(item.worker_id)
      && demand.jobs.some((job) => job.id === item.job_id && job.status !== 'cancelled')) candidates.set(item.worker_id, item);
  }
  return [...candidates.values()];
}

export function demandProgress(demand: Demand) {
  return Math.min(100, Math.max(0, Math.round(demand.hired / Math.max(1, demand.required) * 100)));
}

export function demandAddress(demand: Demand) {
  const job = demand.job;
  return [job.work_address, job.work_number, job.work_neighborhood, [job.work_city, job.work_state].filter(Boolean).join(' / '), job.work_postal_code].filter(Boolean).join(', ');
}

export function demandMapLinks(demand: Demand) {
  const { work_latitude: lat, work_longitude: lng } = demand.job;
  const coordinates = typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90
    && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180;
  const address = demandAddress(demand);
  const destination = coordinates ? `${lat},${lng}` : address;
  return {
    route: destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : null,
    map: coordinates ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.008},${lat - 0.005},${lng + 0.008},${lat + 0.005}&layer=mapnik&marker=${lat},${lng}` : null,
  };
}

export async function shareDemand(demand: Demand) {
  const text = `${demand.job.title}\n${demandDate(demand.job.job_date)} · ${demand.job.start_time.slice(0, 5)} às ${demand.job.end_time.slice(0, 5)}\n${demand.job.location_name || demandAddress(demand) || 'Local a definir'}\n${demand.required} ${demand.required === 1 ? 'profissional' : 'profissionais'}\n${demand.job.description}\nCadastre-se no ExtraChef: ${window.location.origin}/register`;
  if (navigator.share) {
    await navigator.share({ title: demand.job.title, text });
    return '';
  }
  if (!navigator.clipboard) throw new Error('Compartilhamento indisponível neste navegador.');
  await navigator.clipboard.writeText(text);
  return 'Informações copiadas para compartilhar.';
}

export async function loadDemandPeople(client: SupabaseClient, demandId: string, workerId?: string, participantsOnly = true) {
  const people: DemandPerson[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.rpc('demand_talent_directory', {
      p_demand_id: demandId, p_worker_id: workerId ?? null, p_offset: offset, p_limit: 100, p_participants_only: participantsOnly,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Não foi possível carregar os profissionais.');
    const page: DemandPerson[] = data;
    people.push(...page);
    if (page.length < 100) return people;
  }
}

export async function signDemandPhotos(client: SupabaseClient, people: DemandPerson[]) {
  const photos = people.filter((person) => person.photo_path);
  if (!photos.length) return people;
  const paths = photos.flatMap((person) => person.photo_path ? [person.photo_path] : []);
  const { data, error } = await client.storage.from('worker-private').createSignedUrls(paths, 600);
  if (error) throw new Error('Não foi possível carregar as fotos dos profissionais.');
  const urls = new Map<string, string>();
  for (const photo of data ?? []) {
    if (photo.error) throw new Error('Uma foto não está disponível. Tente atualizar os perfis.');
    if (photo.path && photo.signedUrl) urls.set(photo.path, photo.signedUrl);
  }
  if (paths.some((path) => !urls.has(path))) throw new Error('O serviço não retornou todas as fotos. Tente atualizar os perfis.');
  return people.map((person) => ({ ...person, photoUrl: person.photo_path ? urls.get(person.photo_path) ?? null : null }));
}
