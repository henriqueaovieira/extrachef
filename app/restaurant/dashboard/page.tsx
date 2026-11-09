'use client';

import { Badge, Button, Card, EmptyState, LoadingSkeleton, Toast } from '@/app/components/ui';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import RouteFeedback from '@/app/components/route-feedback';
import NotificationBell from '@/app/components/notification-bell';
import { DashboardAvatar, DashboardLogo } from '@/app/components/dashboard-identity';
import { useCommunication } from '@/app/components/communication-state';
import { groupHomeJobs, isUpcomingJob, jobStatusLabels, latestMessagesByJob, type HomeJob as Job } from '@/lib/restaurant-home';
import { canRecruitJob, demandWindow } from '@/lib/demands';
import { loadOperationalAssignments, loadPendingReviews, operationNextAction, type OperationalAssignment, type PendingReview } from '@/lib/operations';
import { loadRestaurantMessageInbox, type RestaurantMessageConversation } from '@/lib/restaurant-message-inbox';
import ProfessionalVerification from '@/app/components/professional-verification';

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
  workerId: string;
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
  const { counts, chatError, error: communicationError } = useCommunication();
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
          .select('id, demand_id, title, job_date, start_time, end_time, status, created_at, demand_archived_at, recruitment_blocked, location_name, location_status, work_latitude, work_longitude, work_address, work_number, work_city, work_state, value')
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
      const openJobIds = activeJobs.filter((job) => canRecruitJob(job, clock)).map((job) => job.id);
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
          const job = group.find((item) => canRecruitJob(item, clock));
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
            workerId: conversation.worker_id,
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
  }, [supabase, reloadKey, counts.messages, clock]);

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
    <main className="ec-restaurant-home min-h-screen bg-gray-50 text-gray-950">
      <header className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <DashboardLogo role="restaurant" />
          <div className="flex items-center gap-3">
            <NotificationBell iconOnly />
            <DashboardAvatar role="restaurant" name={displayName} photoUrl={photoUrl} onImageError={() => {
                setPhotoUrl(null);
                setPageError('Não foi possível exibir a imagem do restaurante.');
              }} />
          </div>
        </div>
        <p className="break-words text-sm text-gray-600">{displayName}</p>
        <h1 className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">Sua central operacional</h1>
        <p className="mt-2 text-sm text-gray-600">Acompanhe suas pendências e operações.</p>
      </header>

      <section className="mx-auto w-full max-w-6xl space-y-8 px-4 pt-6 pb-[calc(16rem+env(safe-area-inset-bottom))] sm:px-6">
        <Suspense fallback={null}><RouteFeedback /></Suspense>
        {chatError && <Toast tone="danger">{chatError}</Toast>}
        {communicationError && <Toast tone="danger">{communicationError}</Toast>}
        {pageError && (
          <Toast tone="danger">
            <p>{pageError}</p>
            <Button variant="ghost" onClick={() => setReloadKey((current) => current + 1)} className="mt-2 min-h-11 font-semibold underline">Tentar novamente</Button>
          </Toast>
        )}
        {operationsError && <Toast tone="danger">{operationsError}</Toast>}
        <section aria-labelledby="pending-heading" className="space-y-4">
          <h2 id="pending-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">Ações pendentes</h2>

          {pendingError && (
            <Toast tone="danger">{pendingError}</Toast>
          )}
          {conversationError && (
            <Toast tone="danger">{conversationError}</Toast>
          )}
          {loading ? (
            <LoadingSkeleton label="Carregando pendências..." />
          ) : pendingActions.length || reviews.length || operationActions.length ? (
            <div className="ec-restaurant-home__actions space-y-4">
              {reviews.map((review) => <Card as="article" key={`review-${review.job_id}`} className="ec-restaurant-home__action flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-2"><Badge tone="warning">Avaliação pendente</Badge><h3 className="break-words text-lg font-semibold">{review.title}</h3><p className="text-sm text-gray-600">Antes de criar uma nova operação, avalie sua última experiência.</p></div>
                <div className="flex min-w-0 items-center"><Link href={`/reviews/${review.job_id}`} className="ec-button ec-button--secondary min-w-0 flex-1 px-4 text-sm sm:flex-none">Avaliar {review.reviewed_name}</Link><ProfessionalVerification jobId={review.job_id} /></div>
              </Card>)}
              {operationActions.map((action) => <Card as="article" key={`operation-${action.jobId}`} className="ec-restaurant-home__action flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-2"><Badge tone="warning">Ação pendente</Badge><h3 className="break-words text-lg font-semibold">{action.title}</h3><p className="text-sm text-gray-600">{action.label}</p></div>
                <Link href={action.href} className="ec-button ec-button--secondary px-4 text-sm">{action.label}</Link>
              </Card>)}
              {pendingActions.slice(0, showAllActions ? pendingActions.length : 8).map((action) => (
                <Card as="article" key={action.id} className="ec-restaurant-home__action flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden="true" className="ec-restaurant-home__icon mt-1 grid size-8 shrink-0 place-items-center text-sm font-semibold">
                      {action.kind === 'application' ? '+' : action.kind === 'staffing' ? '!' : '…'}
                    </span>
                    <div className="min-w-0">
                      <Badge tone="warning">
                        {action.kind === 'application' ? 'Novo candidato aguardando análise' : action.kind === 'staffing' ? 'Equipe incompleta' : 'Mensagem não lida'}
                      </Badge>
                      <p className="mt-2 break-words text-sm text-gray-700">
                        {action.person && <>{action.person}<ProfessionalVerification userId={action.workerId} jobId={action.jobId} />{' · '}</>}{action.demand}{action.kind !== 'staffing' ? ` · ${formatTime(action.createdAt)}` : ''}
                      </p>
                      {action.kind !== 'application' && <p className="mt-2 break-words text-sm text-gray-600">{action.detail}</p>}
                    </div>
                  </div>
                  {action.kind === 'application' ? (
                    <div className="flex min-w-0 items-center">
                      <Link href={`/restaurant/demands/${action.demandId || jobs.find((job) => job.id === action.jobId)?.demand_id || action.jobId}?view=candidates`} className="ec-button ec-button--secondary w-full px-4 text-sm">
                        Analisar e contratar
                      </Link>
                    </div>
                  ) : (
                    <Link href={action.kind === 'staffing' ? `/restaurant/demands/${action.demandId}` : `/chat/${action.jobId}`} className="ec-button ec-button--secondary px-4 text-sm">
                      {action.kind === 'staffing' ? 'Ver candidatos' : 'Responder'}
                    </Link>
                  )}
                </Card>
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
          <h2 id="operations-heading" className="text-xl font-semibold">Operação em evidência</h2>
          {loading ? <LoadingSkeleton label="Carregando operações..." /> : operationCards.length ? operationCards.map(({ id, job, inProgress }, index) => (
            <Link key={id} href={`/restaurant/demands/${id}`} data-priority={index === 0 ? 'primary' : undefined} className="ec-card ec-restaurant-home__operation block space-y-3 transition">
                <Badge tone={inProgress || job.status === 'filled' ? 'info' : 'warning'}>
                  {inProgress ? 'Em andamento' : jobStatusLabels[job.status] ?? 'Agendada'}
                </Badge>
              <h3 className="break-words text-lg font-semibold">{job.title}</h3>
              <p className="text-sm font-medium">{formatDate(job.job_date)} · {job.start_time.slice(0, 5)} às {job.end_time.slice(0, 5)}</p>
              <p className="break-words text-sm text-gray-600">{[job.work_address, job.work_number].filter(Boolean).join(', ') || job.location_name || 'Endereço não informado.'}</p>
              {(job.work_city || job.work_state) && <p className="text-sm text-gray-600">{[job.work_city, job.work_state].filter(Boolean).join(' - ')}</p>}
              <p className="text-sm tabular-nums text-gray-600">Diária: {job.value == null ? '—' : Number(job.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
              {index === 0 && <span className={`ec-button px-4 text-sm ${reviews.length || operationActions.length || pendingActions.length ? 'ec-button--secondary' : 'ec-button--primary'}`}>Ver operação <span aria-hidden="true">→</span></span>}
            </Link>
          )) : !pageError && <div><p className="font-medium">Nenhuma operação agendada.</p><p className="mt-1 text-sm text-gray-600">As próximas operações aparecerão aqui.</p></div>}
        </section>

        <section aria-labelledby="conversations-heading" className="space-y-4">
          <h2 id="conversations-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">Conversas recentes</h2>
          {loading ? (
            <LoadingSkeleton label="Carregando conversas..." />
          ) : conversationError || pageError ? null : conversations.length ? (
            <Card className="divide-y divide-gray-200">
              {conversations.map((conversation) => (
                <article key={conversation.jobId} className="relative flex min-w-0 items-start gap-3 py-4 transition hover:bg-gray-50">
                  <Link href={`/chat/${conversation.jobId}`} aria-label={`Conversa com ${conversation.person} sobre ${conversation.demand}`} className="absolute inset-0 rounded-xl" />
                  <span aria-hidden="true" className="pointer-events-none grid size-8 shrink-0 place-items-center rounded-lg bg-gray-100 text-sm font-semibold text-gray-700">
                    {conversation.person.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="pointer-events-none min-w-0 flex-1">
                    <span className="flex min-w-0 items-center text-sm font-semibold text-gray-950"><span className="min-w-0 break-words">{conversation.person}</span><ProfessionalVerification userId={conversation.workerId} /></span>
                    <span className="mt-2 block break-words text-sm font-medium text-gray-800">{conversation.demand}</span>
                    {conversation.content && <span className="mt-2 block break-words text-sm text-gray-600">{conversation.content}</span>}
                    {conversation.createdAt && <span className="mt-2 block text-xs text-gray-600">{formatTime(conversation.createdAt)}</span>}
                  </span>
                </article>
              ))}
            </Card>
          ) : (
            <Card>
              <p className="font-medium text-gray-800">Ainda não existem conversas.</p>
              <p className="mt-1 text-sm text-gray-600">As mensagens com profissionais contratados aparecerão aqui.</p>
            </Card>
          )}
        </section>

        <section aria-labelledby="summary-heading" className="ec-restaurant-home__summary space-y-4">
          <h2 id="summary-heading" className="text-lg font-semibold text-gray-800">Resumo operacional</h2>
          <dl aria-label="Resumo operacional" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {([
              ['Operações em andamento', operationsLoading ? '—' : inProgressCount],
              ['Próximas operações', loading ? '—' : upcomingCount],
              ['Mensagens não lidas', counts.messages ?? '—'],
            ] as const).map(([label, count]) => (
              <div key={label} className="ec-card min-w-0">
                <dt className="break-words text-xs text-gray-600">{label}</dt>
                <dd className="mt-2 break-words text-lg font-semibold tabular-nums text-gray-700">{count}</dd>
              </div>
            ))}
          </dl>
        </section>

      </section>
      <div className="ec-restaurant-home__create pointer-events-none fixed inset-x-0 z-30 flex justify-center bg-gray-50 px-4 py-2 sm:px-6">
        <Link href="/restaurant/dashboard/jobs/create" className={`ec-button pointer-events-auto mx-auto w-full max-w-xl px-4 text-sm ${loading || operationsLoading || pageError || operationsError || pendingError || conversationError || reviews.length || operationActions.length || pendingActions.length || operationCards.length ? 'ec-button--secondary' : 'ec-button--primary'}`}>
          <span aria-hidden="true" className="text-xl font-normal">+</span> Criar Operação
        </Link>
      </div>
      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
