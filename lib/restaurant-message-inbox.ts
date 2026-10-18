import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperationalContext } from '@/lib/operations';

export type RestaurantOperationalStatus = 'Contratado' | 'Check-in pendente' | 'Em operação' | 'Pagamento pendente' | 'Checkout pendente' | 'Concluída' | 'Encerrada';

export interface RestaurantMessageConversation {
  job_id: string;
  demand_id: string;
  worker_id: string;
  worker_name: string;
  worker_specialty: string | null;
  worker_score: number | null;
  worker_photo_path: string | null;
  completed_operations: number;
  demand_title: string;
  job_date: string;
  start_time: string;
  end_time: string;
  location: string;
  operational_status: RestaurantOperationalStatus;
  latest_message: string | null;
  latest_message_at: string | null;
  unread_count: number;
}

interface AssignmentRow {
  job_id: string;
  worker_id: string;
  hired_at: string | null;
}

interface JobRow {
  id: string;
  demand_id: string;
  title: string;
  job_date: string;
  start_time: string;
  end_time: string;
}

interface ApplicationRow {
  job_id: string;
  worker_id: string;
}

interface UserRoleRow {
  id: string;
  role: string;
}

interface TalentRow {
  id: string;
  name: string;
  specialties: string[] | null;
  score: number | null;
  photo_path: string | null;
  completed_operations: number;
  reputation: { average_rating: number | null; completed: number } | null;
}

interface LastMessage {
  content: string;
  created_at: string;
}

function isMissingInboxFunction(error: { code?: string; message: string }) {
  return error.code === 'PGRST202'
    && error.message.includes('restaurant_operational_message_inbox');
}

function operationalStatus(phase: string): RestaurantOperationalStatus {
  if (phase === 'confirmed') return 'Contratado';
  if (phase === 'checkin' || phase === 'absence_pending') return 'Check-in pendente';
  if (phase === 'working') return 'Em operação';
  if (phase === 'payment' || phase === 'receipt' || phase === 'payment_disputed') return 'Pagamento pendente';
  if (phase === 'checkout') return 'Checkout pendente';
  if (phase === 'completed') return 'Concluída';
  return 'Encerrada';
}

async function loadInboxWithoutRpc(client: SupabaseClient, restaurantId: string) {
  const assignments: AssignmentRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from('operational_assignments')
      .select('job_id, worker_id, hired_at')
      .eq('restaurant_id', restaurantId)
      .order('hired_at', { ascending: false })
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('O serviço não retornou as operações contratadas.');
    assignments.push(...data as AssignmentRow[]);
    if (data.length < 500) break;
  }

  const candidateAssignments = assignments.filter((assignment) => assignment.worker_id !== restaurantId);
  if (!candidateAssignments.length) return [];

  const userIds = [...new Set([restaurantId, ...candidateAssignments.map((assignment) => assignment.worker_id)])];
  const roleById = new Map<string, string>();
  for (let offset = 0; offset < userIds.length; offset += 100) {
    const { data, error } = await client.from('users')
      .select('id, role')
      .in('id', userIds.slice(offset, offset + 100));
    if (error) throw new Error(error.message);
    if (!data) throw new Error('O serviço não retornou os participantes das operações.');
    for (const user of data as UserRoleRow[]) roleById.set(user.id, user.role);
  }
  if (roleById.get(restaurantId) !== 'restaurant') return [];

  const validAssignments = candidateAssignments.filter((assignment) => roleById.get(assignment.worker_id) === 'worker');
  if (!validAssignments.length) return [];

  const jobIds = [...new Set(validAssignments.map((assignment) => assignment.job_id))];
  const jobs: JobRow[] = [];
  for (let offset = 0; offset < jobIds.length; offset += 100) {
    const { data, error } = await client.from('jobs')
      .select('id, demand_id, title, job_date, start_time, end_time')
      .eq('restaurant_id', restaurantId)
      .in('id', jobIds.slice(offset, offset + 100));
    if (error) throw new Error(error.message);
    if (!data) throw new Error('O serviço não retornou as demandas das operações.');
    jobs.push(...data as JobRow[]);
  }

  const applications: ApplicationRow[] = [];
  for (let offset = 0; offset < jobIds.length; offset += 100) {
    const { data, error } = await client.from('applications')
      .select('job_id, worker_id')
      .in('job_id', jobIds.slice(offset, offset + 100))
      .in('status', ['approved', 'in_progress', 'completed']);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('O serviço não retornou as contratações.');
    applications.push(...data as ApplicationRow[]);
  }

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const approvedByJob = new Map(applications.map((application) => [
    `${application.job_id}:${application.worker_id}`,
    true,
  ]));
  const eligible = validAssignments.filter((assignment) => jobById.has(assignment.job_id)
    && approvedByJob.has(`${assignment.job_id}:${assignment.worker_id}`));

  const conversations: RestaurantMessageConversation[] = [];
  for (let offset = 0; offset < eligible.length; offset += 20) {
    const page = await Promise.all(eligible.slice(offset, offset + 20).map(async (assignment) => {
      const job = jobById.get(assignment.job_id);
      if (!job) return null;
      const [talentResult, contextResult, latestResult, unreadResult] = await Promise.all([
        client.rpc('demand_talent_directory', {
          p_demand_id: job.demand_id,
          p_worker_id: assignment.worker_id,
          p_offset: 0,
          p_limit: 1,
          p_participants_only: true,
        }),
        client.rpc('operational_context', { p_job_id: assignment.job_id }),
        client.from('messages').select('content, created_at')
          .eq('job_id', assignment.job_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        client.from('messages').select('id', { count: 'exact', head: true })
          .eq('job_id', assignment.job_id)
          .neq('sender_id', restaurantId)
          .is('read_at', null),
      ]);
      if (talentResult.error) throw new Error(talentResult.error.message);
      if (contextResult.error) throw new Error(contextResult.error.message);
      if (latestResult.error) throw new Error(latestResult.error.message);
      if (unreadResult.error) throw new Error(unreadResult.error.message);
      if (unreadResult.count === null) throw new Error('O serviço não retornou a contagem de mensagens não lidas.');
      const talent = (talentResult.data as TalentRow[] | null)?.[0];
      const context = contextResult.data as OperationalContext | null;
      if (!talent || !context) {
        // Skips an inconsistent operation without blocking the remaining valid conversations.
        console.warn('[Mensagens] Operação inconsistente ignorada', {
          job_id: assignment.job_id,
          demand_id: job.demand_id,
          worker_id: assignment.worker_id,
          worker: {
            encontrado: Boolean(talent),
            worker_name: talent?.name ?? null,
            resposta_tipo: Array.isArray(talentResult.data) ? 'array' : typeof talentResult.data,
            linhas: Array.isArray(talentResult.data) ? talentResult.data.length : null,
          },
          operationalContext: {
            encontrado: Boolean(context),
            resposta_tipo: Array.isArray(contextResult.data) ? 'array' : typeof contextResult.data,
            job_id: context?.job_id ?? null,
            demand_id: context?.demand_id ?? null,
            title: context?.title ?? null,
            phase: context?.phase ?? null,
            location: context?.location ?? null,
          },
        });
        return null;
      }
      const latest = latestResult.data as LastMessage | null;

      return {
        job_id: assignment.job_id,
        demand_id: job.demand_id,
        worker_id: assignment.worker_id,
        worker_name: talent.name,
        worker_specialty: talent.specialties?.[0] ?? null,
        worker_score: talent.reputation?.average_rating ?? talent.score,
        worker_photo_path: talent.photo_path,
        completed_operations: Number(talent.reputation?.completed ?? talent.completed_operations),
        demand_title: job.title,
        job_date: job.job_date,
        start_time: job.start_time,
        end_time: job.end_time,
        location: context.location || 'Local a definir',
        operational_status: operationalStatus(context.phase),
        latest_message: latest?.content ?? null,
        latest_message_at: latest?.created_at ?? null,
        unread_count: unreadResult.count ?? 0,
      } satisfies RestaurantMessageConversation;
    }));
    conversations.push(...page.filter((conversation): conversation is RestaurantMessageConversation => conversation !== null));
  }
  const hiredAt = new Map(eligible.map((assignment) => [assignment.job_id, assignment.hired_at ?? '']));
  const activityAt = (conversation: RestaurantMessageConversation) => conversation.latest_message_at ?? hiredAt.get(conversation.job_id) ?? '';
  return conversations.sort((a, b) => activityAt(b).localeCompare(activityAt(a)) || a.job_id.localeCompare(b.job_id));
}

export async function loadRestaurantMessageInbox(client: SupabaseClient, restaurantId: string) {
  const { data, error } = await client.rpc('restaurant_operational_message_inbox', {
    p_offset: 0,
    p_limit: 100,
  });
  if (error) {
    if (!isMissingInboxFunction(error)) throw new Error(error.message);
    return loadInboxWithoutRpc(client, restaurantId);
  }
  if (!Array.isArray(data)) throw new Error('O serviço não retornou as conversas operacionais.');

  const conversations: RestaurantMessageConversation[] = [...data as RestaurantMessageConversation[]];
  if (data.length === 100) {
    for (let offset = 100; ; offset += 100) {
      const { data: nextPage, error: pageError } = await client.rpc('restaurant_operational_message_inbox', {
        p_offset: offset,
        p_limit: 100,
      });
      if (pageError) throw new Error(pageError.message);
      if (!Array.isArray(nextPage)) throw new Error('O serviço não retornou as conversas operacionais.');
      conversations.push(...nextPage as RestaurantMessageConversation[]);
      if (nextPage.length < 100) break;
    }
  }
  return conversations;
}
