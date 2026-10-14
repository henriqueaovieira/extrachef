'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { getDeviceCoordinates } from '@/lib/geolocation';

interface CheckoutContext {
  job_id: string;
  job_title: string;
  job_date: string;
  start_time: string;
  end_time: string;
  application_status: 'in_progress' | 'completed';
  checkin_time: string;
  checkout_time: string | null;
}

function formatJobDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR');
}

function formatJobTime(value: string) {
  return value.slice(0, 5);
}

export default function CheckoutClient({ jobId }: { jobId: string }) {
  const [supabase] = useState(() => createClient());
  const [context, setContext] = useState<CheckoutContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadCheckoutContext() {
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError || !authData.user) {
        if (isMounted) {
          setErrorMessage('Entre na sua conta para acessar o check-out.');
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase.rpc('get_worker_checkout_context', {
        p_job_id: jobId,
      });

      if (!isMounted) return;

      if (error) {
        setErrorMessage(error.message);
      } else {
        const checkoutContext = (Array.isArray(data) ? data[0] : data) as CheckoutContext | null;
        if (checkoutContext) {
          setContext(checkoutContext);
          if (checkoutContext.checkout_time) {
            setSuccessMessage('Serviço finalizado com sucesso.');
          }
        } else {
          setErrorMessage('Não foi possível carregar os dados desta vaga.');
        }
      }

      setLoading(false);
    }

    void loadCheckoutContext();

    return () => {
      isMounted = false;
    };
  }, [jobId, supabase]);

  const performCheckout = async () => {
    if (!context || context.application_status !== 'in_progress' || submitting) return;

    setSubmitting(true);
    setLocating(true);
    setErrorMessage('');

    try {
      const coordinates = await getDeviceCoordinates();
      setLocating(false);
      const { data, error } = await supabase.rpc('register_worker_checkout', {
        p_job_id: jobId,
        p_latitude: coordinates.latitude,
        p_longitude: coordinates.longitude,
      });

      if (error) throw new Error(error.message);
      const result = (Array.isArray(data) ? data[0] : data) as {
        checkout_id: string;
        checkout_time: string;
      } | null;
      if (!result) throw new Error('O check-out não retornou um horário válido.');

      setContext((current) => current
        ? { ...current, application_status: 'completed', checkout_time: result.checkout_time }
        : current);
      setSuccessMessage('Serviço finalizado com sucesso.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível finalizar a diária.');
    } finally {
      setLocating(false);
      setSubmitting(false);
    }
  };

  const completed = Boolean(context?.checkout_time);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-emerald-700">ExtraChef</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Finalização do serviço</h1>
          </div>
          <Link
            href="/worker/applications"
            className="text-sm font-medium text-gray-600 hover:text-emerald-700"
          >
            Minhas candidaturas
          </Link>
        </header>

        {loading ? (
          <p className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            Carregando dados da vaga...
          </p>
        ) : errorMessage && !context ? (
          <div className="space-y-4 rounded-xl border border-red-200 bg-white p-6">
            <p role="alert" className="text-sm text-red-700">{errorMessage}</p>
            <Link href="/login" className="text-sm font-semibold text-emerald-700 hover:underline">
              Fazer login
            </Link>
          </div>
        ) : context ? (
          <article className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase text-gray-500">Vaga</p>
              <h2 className="text-xl font-bold text-gray-900">{context.job_title}</h2>
            </div>

            <dl className="grid gap-4 border-y border-gray-100 py-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-gray-500">Data</dt>
                <dd className="mt-1 text-sm font-semibold text-gray-900">{formatJobDate(context.job_date)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Horário</dt>
                <dd className="mt-1 text-sm font-semibold text-gray-900">
                  {formatJobTime(context.start_time)} às {formatJobTime(context.end_time)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Check-in</dt>
                <dd className="mt-1 text-sm font-semibold text-gray-900">
                  {new Date(context.checkin_time).toLocaleString('pt-BR')}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Status</dt>
                <dd className="mt-1">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${completed ? 'bg-gray-100 text-gray-700' : 'bg-blue-50 text-blue-800'}`}>
                    {completed ? 'Concluída' : 'Em andamento'}
                  </span>
                </dd>
              </div>
            </dl>

            {errorMessage && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {errorMessage}
              </p>
            )}

            {successMessage && completed ? (
              <div role="status" className="space-y-2 rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="font-semibold text-green-800">✅ {successMessage}</p>
                <p className="text-sm text-green-800">
                  Check-out registrado: {new Date(context.checkout_time!).toLocaleString('pt-BR')}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={performCheckout}
                disabled={submitting || context.application_status !== 'in_progress'}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {locating ? 'Obtendo localização...' : submitting ? 'Finalizando...' : 'Finalizar diária'}
              </button>
            )}
          </article>
        ) : null}
      </section>
      <MobileBottomNav role="worker" />
    </main>
  );
}