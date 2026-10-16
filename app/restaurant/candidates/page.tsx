'use client';

import { Badge, Button, EmptyState, LoadingSkeleton } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import CommunicationNavigation from '@/app/components/communication-navigation';

interface Application {
  job_id: string;
  worker_id: string;
  status: string;
  created_at: string;
}

function getApplicationKey(application: Application) {
  return `${application.job_id}-${application.worker_id}-${application.created_at}`;
}

export default function RestaurantCandidatesPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [filledJobIds, setFilledJobIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let isMounted = true;

    async function loadApplications() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('applications')
        .select('job_id, worker_id, status, created_at')
        .order('created_at', { ascending: false });

      if (!isMounted) return;

      if (error) {
        setErrorMessage(error.message);
      } else {
        setApplications((data ?? []) as Application[]);
      }

      setLoading(false);
    }

    void loadApplications();

    return () => {
      isMounted = false;
    };
  }, []);

  const approveApplication = async (application: Application) => {
    setActionError('');
    setApprovingKey(getApplicationKey(application));

    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('approve_application', {
        p_job_id: application.job_id,
        p_worker_id: application.worker_id,
      });

      if (error) {
        setActionError(error.message);
        return;
      }

      setApplications((current) => current.map((item) => (
        item.job_id === application.job_id && item.worker_id === application.worker_id
          ? { ...item, status: 'approved' }
          : item
      )));
      setFilledJobIds((current) => new Set(current).add(application.job_id));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível aprovar a candidatura.');
    } finally {
      setApprovingKey(null);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 pb-28 sm:px-6 sm:py-10 md:pb-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Candidaturas</h1>
            <p className="mt-1 text-sm text-gray-500">Registros enviados para as vagas.</p>
          </div>
          <CommunicationNavigation role="restaurant" />
          <Link
            href="/restaurant/dashboard"
            className="inline-flex min-h-10 items-center rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700"
          >
            Voltar ao Dashboard
          </Link>
        </header>

        {actionError && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Não foi possível aprovar a candidatura: {actionError}
          </p>
        )}

        {loading ? (
          <LoadingSkeleton label="Carregando candidaturas..." />
        ) : errorMessage ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Não foi possível carregar as candidaturas: {errorMessage}
          </p>
        ) : applications.length === 0 ? (
          <EmptyState icon="◇" title="Nenhuma candidatura encontrada."
            description="Quando um profissional se candidatar, você poderá acompanhar os registros aqui."
            action={<Link href="/restaurant/dashboard/jobs/create" className="inline-flex min-h-12 items-center font-semibold text-orange-800">Publicar uma vaga</Link>} />
        ) : (
          <div id="chats" className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">job_id</th>
                  <th scope="col" className="px-5 py-3 font-semibold">worker_id</th>
                  <th scope="col" className="px-5 py-3 font-semibold">status</th>
                  <th scope="col" className="px-5 py-3 font-semibold">created_at</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {applications.map((application) => {
                  const applicationKey = getApplicationKey(application);
                  const jobFilled = filledJobIds.has(application.job_id);

                  return (
                    <tr key={applicationKey} className="text-gray-700">
                      <td className="break-all px-5 py-4 font-mono text-xs">{application.job_id}</td>
                      <td className="break-all px-5 py-4 font-mono text-xs">{application.worker_id}</td>
                      <td className="px-5 py-4">
                        <Badge tone={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'danger' : application.status === 'pending' ? 'warning' : 'neutral'}>
                          {application.status}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4">
                        {new Date(application.created_at).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-5 py-4">
                        {application.status === 'completed' ? (
                          <div className="flex flex-wrap gap-3">
                            <Link href={`/chat/${application.job_id}`} className="min-h-11 content-center font-semibold text-emerald-700 hover:text-emerald-900">Chat</Link>
                            <Link href={`/reviews/${application.job_id}`} className="min-h-11 content-center font-semibold text-amber-700 hover:text-amber-900">Avaliar trabalhador</Link>
                          </div>
                        ) : application.status === 'approved' || application.status === 'in_progress' ? (
                          <Link
                            href={`/chat/${application.job_id}`}
                            className="inline-flex min-h-11 items-center font-semibold text-emerald-700 hover:text-emerald-900"
                          >
                            Abrir chat
                          </Link>
                        ) : application.status === 'pending' && !jobFilled ? (
                          <Button variant="primary"
                            type="button"
                            onClick={() => approveApplication(application)}
                            disabled={approvingKey !== null}
                            className="px-4 py-2 text-sm"
                          >
                            {approvingKey === applicationKey ? 'Aprovando...' : 'Aprovar'}
                          </Button>
                        ) : jobFilled && application.status === 'pending' ? (
                          <span className="text-xs text-gray-500">Vaga preenchida</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}