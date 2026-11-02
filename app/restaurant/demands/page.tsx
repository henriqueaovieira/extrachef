'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, EmptyState, LoadingSkeleton, Toast } from '@/app/components/ui';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import DemandCard from '@/app/components/demand-card';
import { DashboardLogo } from '@/app/components/dashboard-identity';
import { createClient } from '@/lib/supabase/client';
import { buildDemands, demandFilters, filterDemands, loadDemands, type DemandFilter } from '@/lib/demands';

export default function RestaurantDemands() {
  const searchParams = useSearchParams();
  const requested = searchParams.get('filter');
  const filter: DemandFilter = demandFilters.find(([id]) => id === requested)?.[0] ?? 'all';
  const [data, setData] = useState<Awaited<ReturnType<typeof loadDemands>> | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(20);
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const loaded = await loadDemands(supabase);
        if (mounted) setData(loaded);
      } catch (error) {
        if (mounted) setError(error instanceof Error ? error.message : 'Confira sua conexão e tente novamente.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, [retry, supabase]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const demands = data ? buildDemands(data.jobs, data.applications, data.reserves, now) : [];
  const visible = filterDemands(demands, filter, now);
  const counters = [
    ['Operações Ativas', demands.filter((demand) => demand.active).length],
    ['Precisam de Atenção', demands.filter((demand) => demand.attention).length],
    ['Em Andamento', demands.filter((demand) => demand.running).length],
    ['Concluídas', demands.filter((demand) => demand.completed && !demand.archived).length],
  ] as const;

  return (
    <main className="min-h-screen bg-[#fafaf9] px-5 py-8 pb-28 text-gray-950 sm:px-8 sm:py-12">
      <section className="mx-auto max-w-5xl space-y-7">
        <div className="mb-8">
          <DashboardLogo role="restaurant" />
        </div>
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href="/restaurant/dashboard" className="mb-4 inline-flex min-h-11 items-center text-xs font-semibold text-gray-500">← Home</Link>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Operações</h1>
            <p className="mt-2 max-w-[15rem] text-sm leading-6 text-gray-500 sm:max-w-none">Todas as suas necessidades operacionais</p>
          </div>
          <Link href="/restaurant/dashboard/jobs/create" className="ec-button ec-button--primary mt-14 shrink-0 px-3 text-sm sm:px-5">
            <span aria-hidden="true">+</span> Nova Operação
          </Link>
        </header>

        <dl aria-label="Resumo operacional" className="grid grid-cols-2 gap-x-4 gap-y-5 border-y border-gray-200 py-5 sm:grid-cols-4">
          {counters.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium text-gray-500">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{loading || error ? '—' : value}</dd>
            </div>
          ))}
        </dl>

        <div role="group" aria-label="Filtrar operações" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:px-0">
          {demandFilters.map(([id, label]) => (
            <Button key={id} variant="ghost" aria-pressed={filter === id} onClick={() => {
              const url = new URL(window.location.href);
              if (id === 'all') url.searchParams.delete('filter');
              else url.searchParams.set('filter', id);
              window.history.replaceState(null, '', `${url.pathname}${url.search}`);
              setLimit(20);
            }} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${filter === id ? 'border-gray-950 bg-gray-950 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'}`}>
              {label}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((id) => <LoadingSkeleton key={id} label="Carregando operações..." className="min-h-64 border border-gray-100" />)}</div>
        ) : error ? (
          <Toast tone="error" title="Não foi possível carregar suas operações.">
            <p>{error}</p>
            <Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="mt-2 px-0 underline">Tentar Novamente</Button>
          </Toast>
        ) : !demands.length ? (
          <EmptyState
            icon={<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-9"><rect x="7" y="7" width="18" height="22" rx="3" /><path d="M12 7V3h8v4M11 15h10m-10 5h6m-1 4v6m-3-3h6" /></svg>}
            title="Você ainda não possui operações."
            description="Crie sua primeira operação e encontre profissionais rapidamente."
            action={<Link href="/restaurant/dashboard/jobs/create" className="ec-button ec-button--primary px-5">Criar Operação</Link>}
          />
        ) : visible.length ? (
          <>
            <div className="flex items-center justify-between">
              <p role="status" className="text-xs text-gray-500">{visible.length} {visible.length === 1 ? 'operação' : 'operações'}</p>
              <Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 text-xs text-gray-500">Atualizar</Button>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {visible.slice(0, limit).map((demand) => <DemandCard key={demand.id} demand={demand} onChanged={() => setRetry((value) => value + 1)} />)}
            </div>
            {visible.length > limit && <Button className="mx-auto flex px-5" onClick={() => setLimit((value) => value + 20)}>Mostrar mais</Button>}
          </>
        ) : (
          <EmptyState title="Nenhuma operação neste filtro." description="Escolha outro filtro para encontrar suas necessidades operacionais."
            action={<Link href="/restaurant/demands" className="inline-flex min-h-11 items-center font-semibold text-orange-800">Ver todas as operações</Link>} />
        )}
      </section>
      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
