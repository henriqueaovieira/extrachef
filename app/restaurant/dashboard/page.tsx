'use client';

import { EmptyState, LoadingSkeleton } from '@/app/components/ui';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import RouteFeedback from '@/app/components/route-feedback';
import CommunicationNavigation from '@/app/components/communication-navigation';
import { eventLocationLabels, type EventLocationStatus } from '@/lib/event-locations';

interface RestaurantStats {
  total_jobs: number;
  open_jobs: number;
  in_progress_jobs: number;
  completed_jobs: number;
  professionals_hired: number;
  average_rating: number;
}

interface UpcomingEvent {
  id: string;
  title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  expected_people: number;
  location_status: EventLocationStatus;
  location_name: string | null;
  event_city: string | null;
  event_state: string | null;
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
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');

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

    async function loadUpcomingEvents() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (isMounted) {
          setEventsError('Entre na conta do restaurante para ver os eventos.');
          setEventsLoading(false);
        }
        return;
      }

      const now = new Date();
      const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const { data, error } = await supabase
        .from('events')
        .select('id, title, event_date, start_time, end_time, expected_people, location_status, location_name, event_city, event_state')
        .eq('restaurant_id', authData.user.id)
        .eq('status', 'scheduled')
        .gte('event_date', localToday)
        .order('event_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(4);

      if (!isMounted) return;
      if (error) setEventsError('Não foi possível carregar os eventos. Confira a migration de snapshots de eventos.');
      else setUpcomingEvents((data ?? []) as UpcomingEvent[]);
      setEventsLoading(false);
    }

    void loadStats();
    void loadUpcomingEvents();
    return () => {
      isMounted = false;
    };
  }, [supabase]);

  return (
    <main className="min-h-screen bg-[#f5f6f3] text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/restaurant/dashboard" className="text-lg font-bold text-orange-700">ExtraChef</Link>
          <CommunicationNavigation role="restaurant" />
          <nav className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link href="/restaurant/candidates" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 md:inline-flex">Candidaturas</Link>
            <Link href="/restaurant/dashboard/jobs/create" className="hidden rounded-lg bg-orange-700 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-800 md:inline-flex">Criar vaga</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-8 px-4 py-8 pb-28 sm:px-6 md:pb-8">
        <Suspense fallback={null}><RouteFeedback /></Suspense>
        <div>
          <p className="text-sm font-semibold text-orange-700">Painel do restaurante</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-950">Visão geral</h1>
          <p className="mt-2 text-sm text-gray-600">Acompanhe suas vagas e a experiência dos profissionais.</p>
          <Link href="/restaurant/locations" className="mt-3 inline-flex min-h-12 items-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">Meus Locais</Link>
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

        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-950">Próximos eventos</h2>
              <p className="mt-1 text-sm text-gray-600">Eventos futuros agendados pelo restaurante.</p>
            </div>
            <Link href="/restaurant/events" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              Gerenciar eventos
            </Link>
          </div>
          {eventsError ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{eventsError}</p>
          ) : eventsLoading ? (
            <LoadingSkeleton label="Carregando próximos eventos..." />
          ) : upcomingEvents.length === 0 ? (
            <EmptyState icon="▦" title="Sua agenda está livre"
              description="Organize o próximo evento e tenha os detalhes sempre à mão."
              action={<Link href="/restaurant/events" className="inline-flex min-h-12 items-center font-semibold text-orange-800">Criar primeiro evento</Link>} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {upcomingEvents.map((event) => (
                <article key={event.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">
                    {new Date(`${event.event_date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
                  </p>
                  <h3 className="mt-1 font-bold text-gray-950">{event.title}</h3>
                  <p className="mt-2 text-sm text-gray-600">{event.start_time.slice(0, 5)}–{event.end_time.slice(0, 5)} · {event.expected_people} pessoas esperadas</p>
                  <p className="mt-2 text-sm font-semibold text-gray-700">{eventLocationLabels[event.location_status]}</p>
                  {event.location_name && <p className="break-words text-sm text-gray-600">{event.location_name} · {event.event_city}/{event.event_state}</p>}
                </article>
              ))}
            </div>
          )}
        </section>

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