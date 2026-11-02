'use client';

import { Button, EmptyState, LoadingSkeleton } from '@/app/components/ui';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import RouteFeedback from '@/app/components/route-feedback';
import NotificationBell from '@/app/components/notification-bell';
import { DashboardAvatar, DashboardLogo } from '@/app/components/dashboard-identity';
import { useCommunication } from '@/app/components/communication-state';
import { groupHomeJobs, isUpcomingJob, jobStatusLabels, latestMessagesByJob, type HomeJob as Job } from '@/lib/restaurant-home';
import { demandWindow } from '@/lib/demands';
import { loadOperationalAssignments, loadPendingReviews, operationNextAction, type OperationalAssignment, type PendingReview } from '@/lib/operations';
import { loadRestaurantMessageInbox, type RestaurantMessageConversation } from '@/lib/restaurant-message-inbox';

interface Application {
  job_id: string;
  worker_id: string;
  status: string;
  created_at: string;
}

interface Message {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
}

interface DirectoryUser {
  id: string;
  name: string;
}

interface InboxAction {
  id: string;
  kind: 'application' | 'message' | 'staffing';
  createdAt: string;
  person: string;
  demand: string;
  detail: string;
  jobId: string;
  workerId?: string;
  demandId?: string;
}

interface Conversation {
  jobId: string;
  person: string;
  demand: string;
  content: string;
  createdAt: string | null;
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(date: string) {
  const today = localDateString();
  const tomorrow = localDateString(new Date(new Date(`${today}T12:00:00`).getTime() + 86_400_000));
  if (date === today) return 'Hoje';
  if (date === tomorrow) return 'Amanhã';
  return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatTime(date: string) {
  const value = new Date(date);
  const today = localDateString();
  if (localDateString(value) === today) {
    return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return value.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export default function RestaurantDashboard() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showAllActions, setShowAllActions] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pendingActions, setPendingActions] = useState<InboxAction[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pageError, setPageError] = useState('');
  const [pendingError, setPendingError] = useState('');
  const [conversationError, setConversationError] = useState('');
  const { counts } = useCommunication();
  const [operations, setOperations] = useState<OperationalAssignment[]>([]);
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [operationsError, setOperationsError] = useState('');
  const [operationsLoading, setOperationsLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const [assignments, pending] = await Promise.all([loadOperationalAssignments(supabase), loadPendingReviews(supabase)]);
        if (active) { setOperations(assignments); setReviews(pending); setOperationsError(''); }
      } catch (error) {
        if (active) setOperationsError(error instanceof Error ? error.message : 'Não foi possível conferir as pendências operacionais.');
      } finally { refreshing = false; if (active) setOperationsLoading(false); }
    }
    void refresh();
    const timer = window.setInterval(() => { setClock(new Date()); void refresh(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [supabase, reloadKey]);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      setLoading(true);
      setPageError('');
      setPendingError('');
      setConversationError('');
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (authError || !authData.user) {
        setPageError(authError?.message ?? 'Entre na conta do restaurante para ver sua operação.');
        setLoading(false);
        return;
      }

      const userId = authData.user.id;
      const [profileResult, jobsResult, restaurantResult] = await Promise.all([
        supabase.from('public_user_directory').select('name').eq('id', userId).maybeSingle(),
        supabase
          .from('jobs')
          .select('id, demand_id, title, job_date, start_time, end_time, status, location_name, work_address, work_number, work_city, work_state, value')
          .eq('restaurant_id', userId)
          .order('job_date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(1000),
        supabase.from('restaurant_profiles').select('logo_path, trade_name').eq('user_id', userId).maybeSingle(),
      ]);
      if (!mounted) return;

      if (profileResult.error) {
        setPageError(`Não foi possível carregar seu perfil: ${profileResult.error.message}`);
      } else {
        setName(profileResult.data?.name?.trim() ?? '');
      }
      if (restaurantResult.error) {
        setPageError(`Não foi possível carregar a foto do perfil: ${restaurantResult.error.message}`);
      } else {
        setRestaurantName(restaurantResult.data?.trade_name?.trim() ?? '');
        if (restaurantResult.data?.logo_path) {
          const photo = await supabase.storage.from('restaurant-assets')
            .createSignedUrl(restaurantResult.data.logo_path, 300);
          if (!mounted) return;
          if (photo.error) setPageError(`Não foi possível carregar a foto do perfil: ${photo.error.message}`);
          else setPhotoUrl(photo.data.signedUrl);
        } else {
          setPhotoUrl(null);
        }
      }
      if (jobsResult.error) {
        setPageError(`Não foi possível carregar as operações: ${jobsResult.error.message}`);
        setLoading(false);
        return;
      }

      const ownJobs = (jobsResult.data ?? []) as Job[];
      setJobs(ownJobs);
      const activeJobs = ownJobs.filter((job) => isUpcomingJob(job));
      const openJobIds = activeJobs.filter((job) => job.status === 'open').map((job) => job.id);
      const activeDemandIds = new Set(activeJobs.map((job) => job.demand_id || job.id));
      const activeJobIds = ownJobs.filter((job) => activeDemandIds.has(job.demand_id || job.id)).map((job) => job.id);

      if (openJobIds.length === 0) {
        setPendingActions([]);
      }
      if (ownJobs.length === 0) {
        setConversations([]);
      }

      const [pendingResult, confirmedResult, unreadResult, inboxResult] = await Promise.all([
        openJobIds.length
          ? supabase.from('applications')
            .select('job_id, worker_id, status, created_at', { count: 'exact' })
            .in('job_id', openJobIds).eq('status', 'pending')
            .order('created_at', { ascending: false }).limit(1000)
          : Promise.resolve({ data: [], error: null, count: 0 }),
        activeJobIds.length
          ? supabase.from('applications')
            .select('job_id, worker_id, status')
            .in('job_id', activeJobIds).in('status', ['approved', 'in_progress', 'completed']).limit(1000)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('messages')
          .select('id, job_id, sender_id, content, created_at, read_at', { count: 'exact' })
          .neq('sender_id', userId).is('read_at', null)
          .order('created_at', { ascending: false }).limit(50),
        loadRestaurantMessageInbox(supabase, userId).then(
          (data) => ({ data, error: null }),
          (error: unknown) => ({ data: [] as RestaurantMessageConversation[], error: { message: error instanceof Error ? error.message : 'Serviço indisponível' } }),
        ),
      ]);
      if (!mounted) return;

      const jobById = new Map(ownJobs.map((job) => [job.id, job]));
      const actionItems: InboxAction[] = [];
      const pendingApplications = [...new Map(((pendingResult.data ?? []) as Application[]).filter((application) => {
        const job = jobById.get(application.job_id);
        return !(confirmedResult.data ?? []).some((confirmed) => confirmed.worker_id === application.worker_id
          && (jobById.get(confirmed.job_id)?.demand_id || confirmed.job_id) === (job?.demand_id || application.job_id));
      }).map((application) => {
        const job = jobById.get(application.job_id);
        return [`${job?.demand_id || application.job_id}-${application.worker_id}`, application] as const;
      })).values()];
      if (pendingResult.error) {
        setPendingError(`Não foi possível carregar as candidaturas pendentes: ${pendingResult.error.message}`);
      }
      if (confirmedResult.error) {
        setPageError(`Não foi possível carregar os profissionais confirmados: ${confirmedResult.error.message}`);
      }

      // Home and Mensagens share the same source: only valid operational conversations are shown.
      const operationalConversations = inboxResult.data;
      const conversationByJob = new Map(operationalConversations.map((conversation) => [conversation.job_id, conversation]));
      const unreadMessages = ((unreadResult.data ?? []) as Message[]).filter((message) => conversationByJob.has(message.job_id));
      if (unreadResult.error || inboxResult.error) {
        setConversationError(`Não foi possível carregar as conversas: ${(unreadResult.error ?? inboxResult.error)?.message}`);
      }
      const latestUnreadByJob = latestMessagesByJob(unreadMessages);
      for (const application of pendingApplications) {
        const job = jobById.get(application.job_id);
        actionItems.push({
          id: `application-${application.job_id}-${application.worker_id}`,
          kind: 'application',
          createdAt: application.created_at,
          person: '',
          demand: job?.title ?? 'Operação',
          detail: 'Nova candidatura aguardando análise',
          jobId: application.job_id,
          workerId: application.worker_id,
        });
      }
      for (const message of latestUnreadByJob.values()) {
        const job = jobById.get(message.job_id);
        actionItems.push({
          id: `message-${message.job_id}`,
          kind: 'message',
          createdAt: message.created_at,
          person: '',
          demand: job?.title ?? 'Operação',
          detail: message.content,
          jobId: message.job_id,
        });
      }
      if (!pendingResult.error) {
        for (const [demandId, group] of groupHomeJobs(activeJobs)) {
          const job = group.find((item) => item.status === 'open');
          if (!job || pendingApplications.some((application) => group.some((item) => item.id === application.job_id))) continue;
          actionItems.push({
            id: `staffing-${job.id}`, kind: 'staffing',
            createdAt: `${job.job_date}T${job.start_time}`,
            person: '', demand: job.title,
            detail: `${formatDate(job.job_date)} · ${job.start_time.slice(0, 5)} às ${job.end_time.slice(0, 5)}`,
            jobId: job.id, demandId,
          });
        }
      }

      const workerIds = new Set<string>();
      for (const application of pendingApplications) workerIds.add(application.worker_id);
      const directoryResult = workerIds.size
        ? await supabase.from('public_user_directory').select('id, name').in('id', [...workerIds])
        : { data: [], error: null };
      if (!mounted) return;
      if (directoryResult.error) {
        setConversationError(`Não foi possível carregar os nomes dos participantes: ${directoryResult.error.message}`);
      }
      const names = new Map(
        ((directoryResult.data ?? []) as DirectoryUser[]).map((person) => [person.id, person.name]),
      );

      for (const action of actionItems) {
        if (action.kind === 'application' && action.workerId) {
          action.person = names.get(action.workerId) ?? 'Profissional';
        } else if (action.kind === 'message') {
          action.person = conversationByJob.get(action.jobId)?.worker_name ?? 'Profissional';
        }
      }
      setPendingActions(actionItems.sort((a, b) => {
        if (a.kind === 'staffing' && b.kind === 'staffing') return a.createdAt.localeCompare(b.createdAt);
        if (a.kind === 'staffing') return 1;
        if (b.kind === 'staffing') return -1;
        return b.createdAt.localeCompare(a.createdAt);
      }));
      setConversations(
        operationalConversations
          .sort((a, b) => (b.latest_message_at ?? '').localeCompare(a.latest_message_at ?? ''))
          .slice(0, 3)
          .map((conversation) => ({
            jobId: conversation.job_id,
            person: conversation.worker_name,
            demand: conversation.demand_title,
            content: conversation.latest_message ?? '',
            createdAt: conversation.latest_message_at,
          })),
      );
      setLoading(false);
    }

    void loadDashboard();
    return () => {
      mounted = false;
    };
  }, [supabase, reloadKey, counts.messages]);

  const operationActions = operations.flatMap((operation) => {
    const job = jobs.find((job) => job.id === operation.job_id);
    if (!job || operation.interruption || operation.checkout_at) return [];
    const { start, end } = demandWindow(job);
    if (clock < start || (operation.checkin_at && clock < end)) return [];
    return [{ ...operationNextAction(operation, start, end, 'restaurant', clock), title: job.title, jobId: job.id }];
  });
  const displayName = restaurantName || name;
  const operationCards = [...groupHomeJobs(jobs).entries()].flatMap(([demandId, group]) => {
    const activeJobs = group.filter((job) => ['open', 'filled', 'in_progress'].includes(job.status)
      && (job.status === 'in_progress'
        || operations.some((operation) => operation.job_id === job.id && operation.checkin_at && !operation.checkout_at && !operation.interruption)
        || isUpcomingJob(job, clock)));
    if (!activeJobs.length) return [];
    const runningJobs = activeJobs.filter((job) => job.status === 'in_progress'
      || operations.some((operation) => operation.job_id === job.id && operation.checkin_at && !operation.checkout_at && !operation.interruption));
    const job = runningJobs[0] ?? activeJobs[0];
    return [{ id: demandId, job, inProgress: runningJobs.length > 0 }];
  }).sort((a, b) => {
    const priority = (item: typeof a) => item.inProgress ? 0 : formatDate(item.job.job_date) === 'Hoje' ? 1 : formatDate(item.job.job_date) === 'Amanhã' ? 2 : 3;
    return priority(a) - priority(b)
      || `${a.job.job_date}${a.job.start_time}`.localeCompare(`${b.job.job_date}${b.job.start_time}`);
  });
  const inProgressCount = operationCards.filter((operation) => operation.inProgress).length;
  const upcomingCount = operationCards.length - inProgressCount;

  return (
    <main className="min-h-screen bg-white text-gray-950">
      <header className="mx-auto max-w-2xl px-5 pt-8 sm:px-8 sm:pt-12">
        <div className="mb-8 flex items-center justify-between">
          <DashboardLogo role="restaurant" />
          <div className="flex items-center gap-3">
            <NotificationBell iconOnly />
            <DashboardAvatar role="restaurant" name={displayName} photoUrl={photoUrl} onImageError={() => {
                setPhotoUrl(null);
                setPageError('Não foi possível exibir a imagem do restaurante.');
              }} />
          </div>
        </div>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">Bem-vindo 👋</h1>
        <p className="mt-2 text-lg font-semibold text-gray-900">{displayName}</p>
        <p className="mt-2 text-sm text-gray-500 sm:text-base">Central Operacional do seu restaurante</p>
      </header>

      <section className="mx-auto max-w-2xl space-y-10 px-5 pt-10 pb-[calc(12rem+env(safe-area-inset-bottom))] sm:px-8">
        <dl aria-label="Resumo operacional" className="grid grid-cols-3 gap-2 sm:gap-4">
          {([
            ['Operações em andamento', operationsLoading ? '—' : inProgressCount],
            ['Próximas operações', loading ? '—' : upcomingCount],
            ['Mensagens não lidas', counts.messages ?? '—'],
          ] as const).map(([label, count]) => (
            <div key={label} className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-5">
              <dd className="text-2xl font-semibold tabular-nums sm:text-3xl">{count}</dd>
              <dt className="mt-1 text-xs leading-4 text-gray-600 sm:text-sm">{label}</dt>
            </div>
          ))}
        </dl>
        <Suspense fallback={null}><RouteFeedback /></Suspense>
        {pageError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p>{pageError}</p>
            <Button variant="ghost" onClick={() => setReloadKey((current) => current + 1)} className="mt-2 min-h-11 font-semibold underline">Tentar novamente</Button>
          </div>
        )}
        <section aria-labelledby="pending-heading" className="space-y-4">
          <h2 id="pending-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">Ações pendentes</h2>

          {pendingError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{pendingError}</p>
          )}
          {conversationError && (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{conversationError}</p>
          )}
          {loading ? (
            <LoadingSkeleton label="Carregando pendências..." />
          ) : pendingActions.length || reviews.length || operationActions.length ? (
            <div className="divide-y divide-orange-100 rounded-2xl border border-orange-100 bg-orange-50/40 px-4 sm:px-5">
              {reviews.map((review) => <article key={`review-${review.job_id}`} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div><p className="font-semibold">Avaliação pendente · {review.title}</p><p className="mt-1 text-sm text-gray-600">Antes de criar uma nova operação, avalie sua última experiência.</p></div>
                <Link href={`/reviews/${review.job_id}`} className="ec-button ec-button--primary px-4">Avaliar {review.reviewed_name}</Link>
              </article>)}
              {operationActions.map((action) => <article key={`operation-${action.jobId}`} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div><h3 className="font-semibold">{action.title}</h3><p className="mt-1 text-sm text-gray-600">{action.label}</p></div>
                <Link href={action.href} className="ec-button ec-button--primary px-4">{action.label}</Link>
              </article>)}
              {pendingActions.slice(0, showAllActions ? pendingActions.length : 8).map((action) => (
                <article key={action.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden="true" className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${action.kind === 'application' ? 'bg-orange-100 text-orange-900' : 'bg-blue-50 text-blue-800'}`}>
                      {action.kind === 'application' ? '+' : action.kind === 'staffing' ? '!' : '…'}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-950">
                        {action.kind === 'application' ? 'Novo candidato aguardando análise' : action.kind === 'staffing' ? 'Equipe incompleta' : 'Mensagem não lida'}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-gray-600">
                        {action.person ? `${action.person} · ` : ''}{action.demand}{action.kind !== 'staffing' ? ` · ${formatTime(action.createdAt)}` : ''}
                      </p>
                      {action.kind !== 'application' && <p className="mt-1 line-clamp-2 text-sm text-gray-700">{action.detail}</p>}
                    </div>
                  </div>
                  {action.kind === 'application' ? (
                    <div className="flex shrink-0 items-center gap-3 pl-12 sm:pl-0">
                      <Link href={`/restaurant/demands/${action.demandId || jobs.find((job) => job.id === action.jobId)?.demand_id || action.jobId}?view=candidates`} className="ec-button ec-button--primary px-4 text-sm">
                        Analisar e contratar
                      </Link>
                    </div>
                  ) : (
                    <Link href={action.kind === 'staffing' ? `/restaurant/demands/${action.demandId}` : `/chat/${action.jobId}`} className="ml-12 inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-800 transition hover:bg-white sm:ml-0">
                      {action.kind === 'staffing' ? 'Ver candidatos' : 'Responder'}
                    </Link>
                  )}
                </article>
              ))}
              {pendingActions.length > 8 && (
                <Button variant="ghost" aria-expanded={showAllActions} onClick={() => setShowAllActions((current) => !current)} className="inline-flex min-h-12 items-center px-0 text-sm font-semibold text-orange-800 hover:text-orange-950">
                  {showAllActions ? 'Mostrar menos' : 'Ver todas as pendências'}
                </Button>
              )}
            </div>
          ) : pageError || pendingError || conversationError || operationsError || operationsLoading ? null : (
            <EmptyState
              title="Tudo em dia"
              description="Nenhuma pendência encontrada. As próximas ações aparecerão aqui automaticamente."
            />
          )}
        </section>

        <section aria-labelledby="operations-heading" className="space-y-4">
          <h2 id="operations-heading" className="text-xl font-semibold">Operações</h2>
          {loading ? <LoadingSkeleton label="Carregando operações..." /> : operationCards.length ? operationCards.map(({ id, job, inProgress }) => (
            <Link key={id} href={`/restaurant/demands/${id}`} className="block rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${inProgress ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-900'}`}>
                  {inProgress ? 'Em andamento' : jobStatusLabels[job.status] ?? 'Agendada'}
                </span>
                <span className="font-semibold">{job.value == null ? '—' : Number(job.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
              </div>
              <h3 className="mt-3 text-lg font-semibold">{job.title}</h3>
              <p className="mt-1 text-sm text-gray-600">{[job.work_address, job.work_number].filter(Boolean).join(', ') || job.location_name || 'Endereço não informado.'}</p>
              {(job.work_city || job.work_state) && <p className="text-sm text-gray-600">{[job.work_city, job.work_state].filter(Boolean).join(' - ')}</p>}
              <p className="mt-3 text-sm font-medium">{formatDate(job.job_date)}</p>
              <p className="mt-1 text-sm text-gray-600">{job.start_time.slice(0, 5)} às {job.end_time.slice(0, 5)}</p>
            </Link>
          )) : !pageError && <div><p className="font-medium">Nenhuma operação agendada.</p><p className="mt-1 text-sm text-gray-600">As próximas operações aparecerão aqui.</p></div>}
        </section>

        <section aria-labelledby="conversations-heading" className="space-y-4">
          <h2 id="conversations-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">Conversas recentes</h2>
          {loading ? (
            <LoadingSkeleton label="Carregando conversas..." />
          ) : conversationError || pageError ? null : conversations.length ? (
            <div className="divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white px-4 sm:px-5">
              {conversations.map((conversation) => (
                <Link key={conversation.jobId} href={`/chat/${conversation.jobId}`} className="flex min-h-[4.75rem] items-center gap-3 py-3 transition hover:bg-gray-50">
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                    {conversation.person.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-gray-950">{conversation.person}</span>
                      {conversation.createdAt && <span className="shrink-0 text-xs text-gray-500">{formatTime(conversation.createdAt)}</span>}
                    </span>
                    {conversation.content && <span className="mt-0.5 block truncate text-sm text-gray-600">{conversation.content}</span>}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6">
              <p className="font-medium text-gray-800">Ainda não existem conversas.</p>
              <p className="mt-1 text-sm text-gray-600">As mensagens com profissionais contratados aparecerão aqui.</p>
            </div>
          )}
        </section>

      </section>
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex justify-center bg-gradient-to-t from-white via-white/95 to-white/0 px-5 pt-6 pb-4 sm:px-8">
        <Link href="/restaurant/dashboard/jobs/create" className="ec-button ec-button--primary pointer-events-auto mx-auto flex min-h-14 w-full max-w-xl items-center justify-center rounded-2xl text-base shadow-lg shadow-orange-900/10">
          <span aria-hidden="true" className="text-2xl font-normal">+</span> Criar Operação
        </Link>
      </div>
      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
