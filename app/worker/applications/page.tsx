'use client';

import { Badge, Card, EmptyState, LoadingSkeleton } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import CommunicationNavigation from '@/app/components/communication-navigation';
import { demandWindow } from '@/lib/demands';
import { loadOperationalAssignments, loadPendingReviews, operationNextAction, type OperationalAssignment, type PendingReview } from '@/lib/operations';

interface Application {
  id: string;
  job_id: string;
  status: string;
  job: {
    title: string;
    description: string;
    job_date: string;
    start_time: string;
    end_time: string;
    value: number;
    restaurant?: {
      name: string;
    };
  } | null;
}

export default function WorkerApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [signedIn, setSignedIn] = useState(true);
  const [supabase] = useState(() => createClient());
  const [operations, setOperations] = useState<OperationalAssignment[]>([]);
  const [reviews, setReviews] = useState<PendingReview[]>([]);
  const [operationsError, setOperationsError] = useState('');
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function loadApplications() {
      if (refreshing) return;
      refreshing = true;
      try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !user) {
        setSignedIn(false);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('applications')
        .select(`
          id,
          job_id,
          status,
          job:jobs (
            title,
            description,
            job_date,
            start_time,
            end_time,
            value,
            restaurant:users!restaurant_id (name)
          )
        `)
        .eq('worker_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setApplications((data ?? []) as unknown as Application[]);
      }
      const [assignments, pending] = await Promise.all([loadOperationalAssignments(supabase), loadPendingReviews(supabase)]);
      if (active) { setOperations(assignments); setReviews(pending); setOperationsError(''); }
      } catch (error) {
        if (active) setOperationsError(error instanceof Error ? error.message : 'Não foi possível carregar as etapas operacionais.');
      } finally { refreshing = false; if (active) setLoading(false); }
    }

    void loadApplications();
    const timer = window.setInterval(() => { setClock(new Date()); void loadApplications(); }, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [supabase]);

  const statusLabels: Record<string, string> = {
    pending: 'Aguardando resposta',
    accepted: 'Aceita',
    approved: 'Aprovada',
    in_progress: 'Em andamento',
    completed: 'Concluída',
    rejected: 'Não selecionada',
  };

  return (
    <main className="min-h-screen bg-gray-50 pb-28 md:pb-8">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <Link href="/worker/dashboard" className="text-lg font-bold text-orange-600">
            ExtraChef
          </Link>
          <CommunicationNavigation role="worker" />
          <Link href="/worker/dashboard" className="text-sm font-medium text-gray-700 hover:text-orange-600">
            Voltar às vagas
          </Link>
        </div>
      </header>

      <section id="chats" className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Minhas operações e candidaturas</h1>
          <p className="mt-1 text-sm text-gray-500">Confira sua confirmação e o próximo passo de cada trabalho.</p>
          <Link href="/worker/invitations" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-orange-800">Ver meus convites →</Link>
        </div>
        {operationsError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{operationsError}</p>}
        {reviews.map((review) => <Link key={review.job_id} href={`/reviews/${review.job_id}`} className="ec-button ec-button--primary w-full px-4">Avaliar experiência · {review.title}</Link>)}

        {loading ? (
          <LoadingSkeleton label="Carregando candidaturas..." />
        ) : !signedIn ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-700">Entre na sua conta para ver suas candidaturas.</p>
            <Link href="/login" className="mt-4 inline-block font-semibold text-orange-600 hover:underline">
              Fazer login
            </Link>
          </div>
        ) : errorMessage ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Não foi possível carregar suas candidaturas: {errorMessage}
          </p>
        ) : applications.length === 0 ? (
          <EmptyState icon="◇" title="Sua próxima diária está à frente"
            description="Você ainda não se candidatou. Explore os plantões e encontre uma oportunidade para o seu perfil."
            action={<Link href="/worker/dashboard" className="inline-flex min-h-12 items-center font-semibold text-orange-800">Explorar vagas</Link>} />
        ) : (
          <div className="space-y-4">
            {applications.map((application) => {
              const operation = operations.find((item) => item.job_id === application.job_id);
              const window = application.job ? demandWindow(application.job) : null;
              const next = operation && window ? operationNextAction(operation, window.start, window.end, 'worker', clock) : null;
              const label = operation?.interruption ? operation.interruption === 'absent' ? 'Ausência confirmada' : operation.interruption === 'abandoned' ? 'Abandono registrado' : 'Cancelada'
                : application.status === 'in_progress' && window && clock >= window.end ? 'Trabalho encerrado'
                : application.status === 'approved' && window && clock < window.start ? 'Você está confirmado para esta demanda.'
                : application.status === 'approved' ? 'Aguardando Check-in' : statusLabels[application.status] ?? application.status;
              return (
              <Card as="article" key={application.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-gray-900">
                    {application.job?.title ?? 'Vaga indisponível'}
                  </h2>
                  <Badge tone={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'danger' : 'warning'}>
                    {label}
                  </Badge>
                </div>
                {application.job && (
                  <>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-500">
                      <span>{application.job.restaurant?.name ?? 'Estabelecimento'}</span>
                      <span>{application.job.job_date}</span>
                      <span>{application.job.start_time} às {application.job.end_time}</span>
                      <span className="font-semibold text-orange-600">
                        R$ {Number(application.job.value).toFixed(2)}
                      </span>
                    </div>
                  </>
                )}
                {next && <Link href={next.href} className="ec-button ec-button--primary px-4">{next.label}</Link>}
                <details className="border-t border-gray-100 pt-2">
                  <summary className="cursor-pointer py-2 text-sm text-gray-600">Orientações e contato</summary>
                  <p className="py-3 text-sm text-gray-600">{application.job?.description}</p>
                  {['approved', 'in_progress', 'completed'].includes(application.status) && <Link href={`/chat/${application.job_id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-800">Conversar</Link>}
                </details>
              </Card>
            ); })}
          </div>
        )}
      </section>
      <MobileBottomNav role="worker" />
    </main>
  );
}