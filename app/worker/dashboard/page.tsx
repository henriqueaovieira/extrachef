'use client';

import { Badge, Button, EmptyState, LoadingSkeleton, Toast } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import NotificationBell from '@/app/components/notification-bell';
import { DashboardAvatar, DashboardLogo } from '@/app/components/dashboard-identity';
import { getDeviceCoordinates, type DeviceCoordinates } from '@/lib/geolocation';
import { distanceMeters, estimatedDistance } from '@/lib/work-location';
import { loadPendingReviews, type PendingReview } from '@/lib/operations';
import OperationalReputationView from '@/app/components/operational-reputation';
import { canRecruitJob, demandWindow } from '@/lib/demands';

interface Job {
  id: string;
  title: string;
  description: string;
  job_date: string;
  start_time: string;
  end_time: string;
  value: number;
  status: string;
  created_at?: string;
  demand_archived_at?: string | null;
  work_address: string | null;
  work_number: string | null;
  work_city: string | null;
  work_state: string | null;
  work_latitude: number | null;
  work_longitude: number | null;
  location_status?: string;
  location_name: string | null;
  restaurant?: {
    name: string;
    city?: string;
  };
}

interface WorkHistoryItem {
  job_id: string;
  title: string;
  job_date: string;
  start_time: string;
  end_time: string;
  value: number;
  status: string;
  restaurant_name: string | null;
}

interface WorkerStats {
  total_applications: number;
  completed_jobs: number;
  average_rating: number;
  current_score: number;
  history: WorkHistoryItem[];
}

export default function WorkerDashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<{ name: string } | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [estimatedEarnings, setEstimatedEarnings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [supabase] = useState(() => createClient());
  const [workerLocation, setWorkerLocation] = useState<DeviceCoordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [jobsError, setJobsError] = useState('');
  const [applicationsError, setApplicationsError] = useState('');
  const [pageError, setPageError] = useState('');
  const [profileError, setProfileError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [reviewsError, setReviewsError] = useState('');
  const [reviewsReady, setReviewsReady] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let refreshing = false;

    async function loadDashboardData() {
      if (refreshing) return;
      refreshing = true;
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          if (isMounted) {
            setSignedIn(false);
            setLoading(false);
          }
          return;
        }
        const userId = authData.user.id;
        try {
          const pending = await loadPendingReviews(supabase);
          if (!isMounted) return;
          setPendingReviews(pending);
          setReviewsReady(true);
        } catch (error) {
          console.error('Worker pending reviews lookup failed.', error);
          if (isMounted) setReviewsError('Não foi possível conferir as avaliações pendentes.');
        }

        const [profileResult, profilePhotoResult, applicationsResult, jobsResult, statsResult, earningsResult] = await Promise.all([
          supabase.from('public_user_directory').select('name').eq('id', userId).single(),
          supabase.from('worker_profiles').select('profile_photo_path').eq('user_id', userId).maybeSingle(),
          supabase.from('applications').select('job_id').eq('worker_id', userId),
          supabase
            .from('jobs')
            .select('id, title, description, job_date, start_time, end_time, value, status, created_at, demand_archived_at, work_address, work_number, work_city, work_state, work_latitude, work_longitude, location_status, location_name, restaurant:users!restaurant_id(name)')
            .eq('status', 'open')
            .eq('recruitment_available', true)
            .order('job_date', { ascending: true }),
          supabase.rpc('get_worker_dashboard_stats'),
          supabase.rpc('get_worker_estimated_earnings'),
        ]);

        if (!isMounted) return;

        if (profileResult.error) {
          console.error('Worker profile lookup failed.', profileResult.error);
          setProfileError('Não foi possível carregar seus dados profissionais.');
        } else if (profileResult.data) {
          setProfile(profileResult.data);
        } else {
          setProfileError('Não foi possível carregar seus dados profissionais.');
        }
        if (profilePhotoResult.error) {
          console.error('Worker profile photo lookup failed.', profilePhotoResult.error);
        } else if (profilePhotoResult.data?.profile_photo_path) {
          const { data: signedPhoto, error: photoError } = await supabase.storage
            .from('worker-private')
            .createSignedUrl(profilePhotoResult.data.profile_photo_path, 60 * 10);
          if (photoError) console.error('Worker profile photo signing failed.', photoError);
          else if (isMounted && signedPhoto?.signedUrl) setPhotoUrl(signedPhoto.signedUrl);
        }
        if (applicationsResult.error) {
          console.error('Worker applications lookup failed.', applicationsResult.error);
          setApplicationsError('Não foi possível verificar suas candidaturas.');
        } else if (applicationsResult.data) {
          setApplicationsError('');
          setAppliedJobIds(applicationsResult.data.map((application) => application.job_id));
        }
        if (jobsResult.data) { setJobs(jobsResult.data as unknown as Job[]); setJobsError(''); }
        if (jobsResult.error) {
          console.error('Worker job listings lookup failed.', jobsResult.error);
          setJobsError('Não foi possível carregar as vagas.');
        }
        if (statsResult.error) {
          console.error('Worker dashboard stats lookup failed.', statsResult.error);
          setStatsError('Não foi possível carregar seu resumo profissional.');
        } else {
          const result = (Array.isArray(statsResult.data) ? statsResult.data[0] : statsResult.data) as WorkerStats | null;
          if (result) setStats(result);
          else setStatsError('O resumo profissional não retornou dados.');
        }
        if (earningsResult.error) {
          console.error('Worker estimated earnings lookup failed.', earningsResult.error);
        } else {
          const monthlyEarnings = Number(earningsResult.data ?? 0);
          setEstimatedEarnings(Number.isFinite(monthlyEarnings) ? monthlyEarnings : 0);
        }

        setLoading(false);
      } catch (error) {
        if (isMounted) {
          console.error('Worker dashboard load failed.', error);
          setPageError('Não foi possível carregar o painel profissional.');
          setLoading(false);
        }
      } finally { refreshing = false; }
    }

    void loadDashboardData();
    const refresh = () => { void loadDashboardData(); };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [supabase]);

  useEffect(() => {
    if (feedbackMessage !== 'Candidatura enviada com sucesso.') return;
    const timeout = window.setTimeout(() => {
      setFeedbackMessage((current) => current === 'Candidatura enviada com sucesso.' ? '' : current);
    }, 9000);
    return () => window.clearTimeout(timeout);
  }, [feedbackMessage]);

  const handleApply = async (jobId: string) => {
    if (applyingId) return;
    const job = jobs.find((item) => item.id === jobId);
    if (!job || !canRecruitJob(job, new Date())) {
      setNow(new Date());
      setFeedbackMessage('O recrutamento desta operação foi encerrado.');
      return;
    }
    if (!reviewsReady || pendingReviews.length) {
      setFeedbackMessage(pendingReviews.length ? 'Antes de se candidatar novamente, avalie sua última experiência.' : 'Não foi possível conferir suas avaliações pendentes. Atualize a página.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setFeedbackMessage('Sua sessão expirou. Entre novamente.');
      return;
    }

    setApplyingId(jobId);
    setFeedbackMessage('');

    const { error } = await supabase.from('applications').insert({
      job_id: jobId,
      worker_id: user.id,
      status: 'pending',
    });

    if (error) {
      console.error('Worker application submission failed.', { code: error.code });
      setFeedbackMessage(error.code === '23505'
        ? 'Você já se candidatou a esta vaga.'
        : 'Não foi possível enviar sua candidatura. Tente novamente.');
      if (error.code === '23505') setAppliedJobIds((current) => [...new Set([...current, jobId])]);
    } else {
      setFeedbackMessage('Candidatura enviada com sucesso.');
      setAppliedJobIds((current) => [...new Set([...current, jobId])]);
      setStats((current) => current
        ? { ...current, total_applications: current.total_applications + 1 }
        : current);
    }

    setApplyingId(null);
  };

  const shareJob = async (job: Job) => {
    const jobSummary = `${job.title} · ${new Date(`${job.job_date}T00:00:00`).toLocaleDateString('pt-BR')} · ${job.start_time.slice(0, 5)} às ${job.end_time.slice(0, 5)} · R$ ${Number(job.value).toFixed(2)}`;
    const shareUrl = `${window.location.origin}/worker/dashboard#jobs`;

    try {
      if (navigator.share) {
        await navigator.share({ title: `Plantão: ${job.title}`, text: jobSummary, url: shareUrl });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${jobSummary}\n${shareUrl}`);
        setFeedbackMessage('Detalhes do plantão copiados para compartilhar.');
      } else {
        setFeedbackMessage('Compartilhamento não está disponível neste navegador.');
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        setFeedbackMessage('Não foi possível compartilhar este plantão.');
      }
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-500">
        <LoadingSkeleton label="Carregando vagas disponíveis" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-sm space-y-4 rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p className="text-gray-700">Entre na sua conta para acessar o painel.</p>
          <Link href="/login" className="inline-flex min-h-10 items-center rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white">Fazer login</Link>
        </div>
      </main>
    );
  }

  const metricCards = [
    { label: 'Candidaturas', value: stats?.total_applications ?? '—' },
    { label: 'Diárias concluídas', value: stats?.completed_jobs ?? '—' },
    { label: 'Ganhos estimados', value: `R$ ${estimatedEarnings.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
  ];

  return (
    <>
      <main className="min-h-screen bg-white text-gray-950">
        <header className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">
          <div className="mb-8 flex items-center justify-between">
            <DashboardLogo role="worker" />
            <div className="flex items-center gap-3">
              <NotificationBell iconOnly />
              <DashboardAvatar role="worker" name={profile?.name || ''} photoUrl={photoUrl} onImageError={() => {
                  setPhotoUrl(null);
                  setPageError('Não foi possível exibir sua foto de perfil.');
                }} />
            </div>
          </div>
          <h1 className="break-words text-[1.75rem] font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">Bem-vindo 👋</h1>
          <p className="mt-2 break-words text-lg font-semibold text-gray-900">{profile?.name || 'Profissional'}</p>
          <p className="mt-2 text-sm text-gray-500 sm:text-base">Encontre operações e acompanhe suas candidaturas.</p>
        </header>

        <section aria-label="Resumo profissional" className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-2 px-4 pt-10 sm:gap-4 sm:px-6 lg:grid-cols-4">
          {metricCards.map((card) => <article key={card.label} className="flex min-h-32 min-w-0 flex-col justify-between rounded-2xl border border-gray-200 bg-white p-3 sm:p-5">
            <p className={`break-words font-semibold tabular-nums ${card.value === '—' ? 'text-sm text-gray-500' : 'text-2xl sm:text-3xl'}`}>{card.value}</p>
            <p className="mt-1 break-words text-xs leading-4 text-gray-600 sm:text-sm">{card.label}</p>
          </article>)}
          <OperationalReputationView summary />
        </section>

        <section className="mx-auto max-w-6xl space-y-10 px-4 py-8 pb-[calc(12rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 sm:pb-[calc(12rem+env(safe-area-inset-bottom))]">

        {pageError && <Toast tone="error">{pageError}</Toast>}
        {profileError && <Toast tone="error">{profileError}</Toast>}
        {applicationsError && <Toast tone="error">{applicationsError}</Toast>}
        {statsError && <Toast tone="error">{statsError}</Toast>}
        {reviewsError && <Toast tone="error">{reviewsError}</Toast>}
        {pendingReviews.length > 0 && <section className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50 p-5">
          <h2 className="text-lg font-semibold">Avaliação pendente</h2>
          <p className="text-sm text-gray-600">Antes de se candidatar novamente, avalie sua última experiência.</p>
          {pendingReviews.map((review) => <Link key={review.job_id} href={`/reviews/${review.job_id}`} className="ec-button ec-button--primary px-4">Avaliar {review.reviewed_name} · {review.title}</Link>)}
        </section>}
        <section id="historico" className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-gray-950">Histórico de trabalhos</h2>
            <p className="mt-1 text-sm text-gray-600">Suas diárias em andamento e concluídas.</p>
          </div>
          {statsError ? null : !stats?.history?.length ? (
            <p className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">Seu histórico aparecerá após iniciar uma diária.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Vaga</th>
                    <th className="px-4 py-3 font-semibold">Restaurante</th>
                    <th className="px-4 py-3 font-semibold">Data</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Diária</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stats.history.map((item) => (
                    <tr key={`${item.job_id}-${item.job_date}`}>
                      <td className="px-4 py-3 font-medium text-gray-900">{item.title}</td>
                      <td className="px-4 py-3 text-gray-600">{item.restaurant_name || 'Estabelecimento'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{new Date(`${item.job_date}T00:00:00`).toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-3 text-gray-600">{item.status === 'completed' ? 'Concluída' : new Date() >= demandWindow(item).end ? 'Trabalho encerrado' : 'Trabalho em andamento'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">R$ {Number(item.value).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div id="vagas" className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Vagas Abertas</h2>
          <div className="hidden" aria-hidden="true">
            <Button disabled={locating} busy={locating} onClick={() => {
              setLocating(true); setLocationError('');
              void getDeviceCoordinates().then(setWorkerLocation).catch((error: unknown) => {
                setLocationError(error instanceof Error ? error.message : 'Não foi possível obter sua localização.');
              }).finally(() => setLocating(false));
            }}>Mostrar distâncias estimadas (opcional)</Button>
            <p className="text-sm text-gray-600">Localização opcional, usada apenas para distância em linha reta. Não limita vagas ou candidaturas.</p>
            {locationError && <Toast tone="error">{locationError} Você pode continuar se candidatando normalmente.</Toast>}
          </div>

          {feedbackMessage && (
            <Toast tone="info">{feedbackMessage}</Toast>
          )}

          {jobsError ? <Toast tone="error">{jobsError}</Toast> : jobs.filter((job) => canRecruitJob(job, now) && !appliedJobIds.includes(job.id)).length === 0 ? (
            <EmptyState icon="◇" title="Novas oportunidades vêm por aí"
              description="Não há plantões abertos agora. Enquanto isso, deixe seu perfil pronto para a próxima oportunidade."
              action={<Link href="/worker/profile?edit=1" className="inline-flex min-h-12 items-center font-semibold text-orange-800">Revisar meu perfil</Link>} />
          ) : (
            <div className="grid gap-4">
              {jobs.filter((job) => canRecruitJob(job, now) && !appliedJobIds.includes(job.id)).map((job) => {
                const hasApplied = appliedJobIds.includes(job.id);
                const isProcessing = applyingId === job.id;

                return (
                  <div
                    key={job.id}
                    className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-gray-900">{job.title}</h3>
                        <Badge tone="success">
                          Aberta
                        </Badge>
                      </div>

                      <p className="break-words text-sm text-gray-600">{job.description}</p>
                      {job.work_address && <p className="break-words text-sm text-gray-700">{job.location_name} · {job.work_address} {job.work_number} · {job.work_city}/{job.work_state}</p>}
                      {workerLocation && job.work_latitude !== null && job.work_longitude !== null && (
                        <p className="text-sm font-semibold text-gray-700">📍 Distância estimada: {estimatedDistance(distanceMeters(
                          workerLocation.latitude, workerLocation.longitude, job.work_latitude, job.work_longitude,
                        ))} (linha reta)</p>
                      )}
                      {workerLocation && (job.work_latitude === null || job.work_longitude === null) && (
                        <p className="text-sm text-gray-600">Distância indisponível: coordenadas da vaga não cadastradas.</p>
                      )}

                      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 pt-1 font-medium">
                        <span>🏢 {job.restaurant?.name || 'Estabelecimento'}</span>
                        <span>📅 Data: {job.job_date}</span>
                        <span>⏰ Horário: {job.start_time} às {job.end_time}</span>
                        <span className="font-bold text-orange-600">💰 R$ {Number(job.value).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-44">
                      {hasApplied ? (
                        <span className="inline-flex min-h-12 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-5 py-2.5 text-center text-sm font-bold text-gray-600">
                          Candidatura Enviada
                        </span>
                      ) : (
                        <Button variant="primary"
                          type="button"
                          onClick={() => handleApply(job.id)}
                          disabled={isProcessing || applyingId !== null || !reviewsReady || pendingReviews.length > 0}
                          className="w-full px-6 py-2.5 text-sm shadow-sm"
                        >
                          {isProcessing ? 'Enviando...' : 'Candidatar-se'}
                        </Button>
                      )}
                      <Button
                        type="button"
                        onClick={() => void shareJob(job)}
                        className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                      >
                        Compartilhar vaga
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </section>
      </main>
      <MobileBottomNav role="worker" showOnDesktop />
    </>
  );
}