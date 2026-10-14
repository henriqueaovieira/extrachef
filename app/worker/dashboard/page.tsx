'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import NotificationBell from '@/app/components/notification-bell';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';

interface Job {
  id: string;
  title: string;
  description: string;
  job_date: string;
  start_time: string;
  end_time: string;
  value: number;
  status: string;
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
  const [profile, setProfile] = useState<{ name: string; city: string; score: number } | null>(null);
  const [stats, setStats] = useState<WorkerStats | null>(null);
  const [estimatedEarnings, setEstimatedEarnings] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (isMounted) {
          setSignedIn(false);
          setLoading(false);
        }
        return;
      }
      const userId = authData.user.id;

      const [profileResult, applicationsResult, jobsResult, statsResult, earningsResult] = await Promise.all([
        supabase.from('users').select('name, city, score').eq('id', userId).single(),
        supabase.from('applications').select('job_id').eq('worker_id', userId),
        supabase
          .from('jobs')
          .select('id, title, description, job_date, start_time, end_time, value, status, restaurant:users!restaurant_id(name, city)')
          .eq('status', 'open')
          .order('job_date', { ascending: true }),
        supabase.rpc('get_worker_dashboard_stats'),
        supabase.rpc('get_worker_estimated_earnings'),
      ]);

      if (!isMounted) return;

      if (profileResult.data) setProfile(profileResult.data);
      if (applicationsResult.data) {
        setAppliedJobIds(applicationsResult.data.map((application) => application.job_id));
      }
      if (jobsResult.data) setJobs(jobsResult.data as unknown as Job[]);
      if (!statsResult.error) {
        const result = (Array.isArray(statsResult.data) ? statsResult.data[0] : statsResult.data) as WorkerStats | null;
        if (result) setStats(result);
      }
      if (!earningsResult.error) setEstimatedEarnings(Number(earningsResult.data ?? 0));

      setLoading(false);
    }

    void loadDashboardData();
    return () => {
      isMounted = false;
    };
  }, [supabase]);

  const handleApply = async (jobId: string) => {
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
      setFeedbackMessage(error.code === '23505'
        ? 'Você já se candidatou a esta vaga.'
        : `Não foi possível enviar a candidatura: ${error.message}`);
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
        Carregando vagas disponíveis...
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
    { label: 'Candidaturas', value: stats?.total_applications ?? 0, detail: 'Enviadas até agora', accent: 'border-l-orange-500' },
    { label: 'Diárias concluídas', value: stats?.completed_jobs ?? 0, detail: 'Serviços finalizados', accent: 'border-l-blue-600' },
    { label: 'Avaliação média', value: Number(stats?.average_rating ?? 0).toFixed(2), detail: 'Notas recebidas', accent: 'border-l-amber-500' },
    { label: 'Score atual', value: Number(stats?.current_score ?? profile?.score ?? 0).toFixed(2), detail: 'Perfil profissional', accent: 'border-l-emerald-600' },
    { label: 'Ganhos estimados', value: `R$ ${estimatedEarnings.toFixed(2)}`, detail: 'Diárias concluídas; não confirma pagamento', accent: 'border-l-teal-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="font-bold text-xl text-orange-600">🍳 ExtraChef</div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <Link href="/worker/applications" className="hidden text-sm font-medium text-gray-700 hover:text-orange-600 md:inline-flex">
              Minhas Candidaturas
            </Link>
            
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 pb-28 sm:p-6 md:pb-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Olá, {profile?.name || 'Profissional'}</h1>
            <p className="text-sm text-gray-500">Explore e candidate-se aos plantões temporários disponíveis.</p>
          </div>
          <div className="flex gap-4 bg-gray-50 p-3 rounded-xl border">
            <div>
              <span className="block text-[10px] text-gray-400 font-bold uppercase">Score</span>
              <span className="text-base font-bold text-orange-600">⭐ {Number(profile?.score || 5).toFixed(2)}</span>
            </div>
            <div className="w-px bg-gray-200" />
            <div>
              <span className="block text-[10px] text-gray-400 font-bold uppercase">Cidade</span>
              <span className="text-base font-bold text-gray-800">📍 {profile?.city || 'Não informada'}</span>
            </div>
          </div>
        </div>

        <section aria-label="Resumo profissional" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((card) => (
            <article key={card.label} className={`min-h-32 rounded-lg border border-gray-200 border-l-4 ${card.accent} bg-white p-5 shadow-sm`}>
              <p className="text-sm font-medium text-gray-600">{card.label}</p>
              <p className="mt-3 text-3xl font-bold tabular-nums text-gray-950">{card.value}</p>
              <p className="mt-1 text-xs text-gray-500">{card.detail}</p>
            </article>
          ))}
        </section>

        <section id="historico" className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-gray-950">Histórico de trabalhos</h2>
            <p className="mt-1 text-sm text-gray-600">Suas diárias em andamento e concluídas.</p>
          </div>
          {!stats?.history?.length ? (
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
                      <td className="px-4 py-3 text-gray-600">{item.status === 'completed' ? 'Concluída' : 'Em andamento'}</td>
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

          {feedbackMessage && (
            <p role="status" className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">{feedbackMessage}</p>
          )}

          {jobs.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm text-gray-500">
              Nenhuma vaga aberta no momento. Volte em breve!
            </div>
          ) : (
            <div className="grid gap-4">
              {jobs.map((job) => {
                const hasApplied = appliedJobIds.includes(job.id);
                const isProcessing = applyingId === job.id;

                return (
                  <div
                    key={job.id}
                    className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-gray-900">{job.title}</h3>
                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
                          Aberta
                        </span>
                      </div>

                      <p className="text-sm text-gray-600">{job.description}</p>

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
                        <button
                          type="button"
                          onClick={() => handleApply(job.id)}
                          disabled={isProcessing}
                          className="min-h-12 w-full rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
                        >
                          {isProcessing ? 'Enviando...' : 'Candidatar-se'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void shareJob(job)}
                        className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-800 transition hover:bg-gray-50"
                      >
                        Compartilhar vaga
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <MobileBottomNav role="worker" />
    </div>
  );
}