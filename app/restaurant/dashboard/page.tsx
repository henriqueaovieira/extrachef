'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import NotificationBell from '@/app/components/notification-bell';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';

interface RestaurantStats {
  total_jobs: number;
  open_jobs: number;
  in_progress_jobs: number;
  completed_jobs: number;
  professionals_hired: number;
  average_rating: number;
}

const metricCards: Array<{
  key: keyof RestaurantStats;
  label: string;
  detail: string;
  accent: string;
  format?: (value: number) => string;
}> = [
  { key: 'total_jobs', label: 'Vagas criadas', detail: 'No total', accent: 'border-l-gray-400' },
  { key: 'open_jobs', label: 'Abertas', detail: 'Recebendo candidaturas', accent: 'border-l-emerald-600' },
  { key: 'in_progress_jobs', label: 'Em andamento', detail: 'Profissional em serviço', accent: 'border-l-blue-600' },
  { key: 'completed_jobs', label: 'Concluídas', detail: 'Diárias finalizadas', accent: 'border-l-violet-600' },
  { key: 'professionals_hired', label: 'Profissionais contratados', detail: 'Pessoas únicas', accent: 'border-l-orange-500' },
  { key: 'average_rating', label: 'Avaliação recebida', detail: 'Média das avaliações', accent: 'border-l-amber-500', format: (value) => value.toFixed(2) },
];

export default function RestaurantDashboard() {
  const [supabase] = useState(() => createClient());
  const [stats, setStats] = useState<RestaurantStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      const { data, error } = await supabase.rpc('get_restaurant_dashboard_stats');
      if (!isMounted) return;

      if (error) {
        setErrorMessage(error.message);
      } else {
        const result = (Array.isArray(data) ? data[0] : data) as RestaurantStats | null;
        setStats(result);
      }
      setLoading(false);
    }

    void loadStats();
    return () => {
      isMounted = false;
    };
  }, [supabase]);

  return (
    <main className="min-h-screen bg-[#f5f6f3] text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/restaurant/dashboard" className="text-lg font-bold text-orange-700">ExtraChef</Link>
          <nav className="flex flex-wrap items-center gap-2 sm:gap-3">
            <NotificationBell />
            <Link href="/restaurant/candidates" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 md:inline-flex">Candidaturas</Link>
            <Link href="/restaurant/dashboard/jobs/create" className="hidden rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 md:inline-flex">Criar vaga</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-8 px-4 py-8 pb-28 sm:px-6 md:pb-8">
        <div>
          <p className="text-sm font-semibold text-orange-700">Painel do restaurante</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-950">Visão geral</h1>
          <p className="mt-2 text-sm text-gray-600">Acompanhe suas vagas e a experiência dos profissionais.</p>
        </div>

        {errorMessage ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar os indicadores: {errorMessage}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {metricCards.map((card) => (
              <article key={card.key} className={`min-h-32 rounded-lg border border-gray-200 border-l-4 ${card.accent} bg-white p-5 shadow-sm`}>
                <p className="text-sm font-medium text-gray-600">{card.label}</p>
                <p className="mt-3 text-3xl font-bold tabular-nums text-gray-950">
                  {loading ? '—' : card.format
                    ? card.format(Number(stats?.[card.key] ?? 0))
                    : Number(stats?.[card.key] ?? 0)}
                </p>
                <p className="mt-1 text-xs text-gray-500">{card.detail}</p>
              </article>
            ))}
          </div>
        )}

        <section className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Próximo passo</h2>
            <p className="mt-1 text-sm text-gray-600">Acesse as candidaturas para acompanhar e avaliar as diárias concluídas.</p>
          </div>
          <Link href="/restaurant/candidates" className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50">Ver candidaturas</Link>
        </section>
      </section>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}