'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';

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
  const supabase = createClient();

  useEffect(() => {
    async function loadApplications() {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

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

      setLoading(false);
    }

    loadApplications();
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
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/worker/dashboard" className="text-lg font-bold text-orange-600">
            ExtraChef
          </Link>
          <Link href="/worker/dashboard" className="text-sm font-medium text-gray-700 hover:text-orange-600">
            Voltar às vagas
          </Link>
        </div>
      </header>

      <section id="chats" className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Minhas Candidaturas</h1>
          <p className="mt-1 text-sm text-gray-500">Acompanhe suas inscrições para os plantões.</p>
        </div>

        {loading ? (
          <p className="py-12 text-center text-gray-500">Carregando candidaturas...</p>
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
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
            Você ainda não se candidatou a nenhuma vaga.
          </div>
        ) : (
          <div className="space-y-4">
            {applications.map((application) => (
              <article key={application.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-gray-900">
                    {application.job?.title ?? 'Vaga indisponível'}
                  </h2>
                  <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                    {statusLabels[application.status] ?? application.status}
                  </span>
                </div>
                {application.job && (
                  <>
                    <p className="text-sm text-gray-600">{application.job.description}</p>
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
                {application.status === 'approved' && (
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={`/chat/${application.job_id}`}
                      className="inline-flex min-h-12 items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800"
                    >
                      Abrir chat
                    </Link>
                    <Link
                      href={`/checkin/${application.job_id}`}
                      className="inline-flex min-h-12 items-center rounded-lg border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
                    >
                      Realizar check-in
                    </Link>
                  </div>
                )}
                {application.status === 'in_progress' && (
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/chat/${application.job_id}`} className="inline-flex min-h-12 items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Abrir chat</Link>
                    <Link
                      href={`/checkout/${application.job_id}`}
                      className="inline-flex min-h-12 items-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800"
                    >
                      Finalizar diária
                    </Link>
                  </div>
                )}
                {application.status === 'completed' && (
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/chat/${application.job_id}`} className="inline-flex min-h-12 items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Abrir chat</Link>
                    <Link
                      href={`/checkout/${application.job_id}`}
                      className="inline-flex min-h-12 items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                    >
                      Ver finalização
                    </Link>
                    <Link
                      href={`/reviews/${application.job_id}`}
                      className="inline-flex min-h-12 items-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
                    >
                      Avaliar restaurante
                    </Link>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <MobileBottomNav role="worker" />
    </main>
  );
}