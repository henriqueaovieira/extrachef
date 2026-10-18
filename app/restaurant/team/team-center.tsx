'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, LoadingSkeleton, Toast } from '@/app/components/ui';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { createClient } from '@/lib/supabase/client';
import {
  formatClock,
  formatHireDay,
  hireTimeline,
  loadRestaurantTeam,
  type TeamHire,
  type TimelineStatus,
} from '@/lib/restaurant-team';

const timelineIcon: Record<TimelineStatus, string> = { done: '✅', current: '⏳', pending: '○', incident: '⚠' };

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return <Button variant="secondary" className="px-3 text-xs" onClick={() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }}>{copied ? 'Código copiado' : 'Copiar código'}</Button>;
}

function NextAction({ hire, full = false }: { hire: TeamHire; full?: boolean }) {
  if (!hire.action) return null;
  const primary = hire.priority <= 5;
  return <Link href={hire.action.href} className={`ec-button ${primary ? 'ec-button--primary' : 'ec-button--secondary'} px-4 text-sm ${full ? 'w-full' : ''}`}>{hire.action.label}</Link>;
}

export default function TeamCenter() {
  const [supabase] = useState(() => createClient());
  const [hires, setHires] = useState<TeamHire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function load(initial: boolean) {
      if (refreshing) return;
      refreshing = true;
      if (initial) setLoading(true);
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError || !data.user) throw new Error('Entre na conta da empresa para acompanhar sua equipe.');
        const current = new Date();
        const loaded = await loadRestaurantTeam(supabase, data.user.id, current);
        if (active) { setHires(loaded); setNow(current); setError(''); }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a equipe.');
      } finally {
        refreshing = false;
        if (active) setLoading(false);
      }
    }
    void load(true);
    const timer = window.setInterval(() => void load(false), 30_000);
    const onFocus = () => void load(false);
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [retry, supabase]);

  return <TeamBoard hires={hires} now={now} loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)} />;
}

export function TeamBoard({ hires, now, loading, error, onRetry }: {
  hires: TeamHire[];
  now: Date;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = hires.find((hire) => hire.context.job_id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(null); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [selected]);

  const heading = (hire: TeamHire) => `${hire.context.title} • ${formatHireDay(hire.context.starts_at, now)}`;
  const hours = (hire: TeamHire) => `${formatClock(hire.context.starts_at)} às ${formatClock(hire.context.ends_at)}`;

  return (
    <main className="min-h-screen bg-[#fafaf9] px-4 py-5 pb-28 text-gray-950 sm:px-8 sm:py-7">
      <section className="mx-auto max-w-3xl space-y-4">
        <header>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Equipe</h1>
          <p className="mt-1 text-sm leading-6 text-gray-600">Acompanhe suas contratações em andamento.</p>
        </header>

        {error && <Toast tone="error" title="Não foi possível carregar a equipe."><p>{error}</p><Button variant="ghost" onClick={onRetry} className="px-0 underline">Tentar novamente</Button></Toast>}

        {loading ? <div className="space-y-3">{[0, 1, 2].map((item) => <LoadingSkeleton key={item} label="Carregando contratações..." />)}</div>
          : error && !hires.length ? null
            : !hires.length ? <EmptyState icon="👥" title="Nenhuma contratação em andamento."
              description="As contratações aparecerão aqui após aprovação na Central de Talentos."
              action={<Link href="/restaurant/candidates" className="ec-button ec-button--primary px-4">Ir para Talentos</Link>} />
              : <ul aria-label="Contratações" className="space-y-3">
                {hires.map((hire) => <li key={hire.context.job_id}>
                  <article className={`ec-card relative space-y-2 transition hover:border-gray-300 ${hire.state === 'future' ? 'opacity-80' : ''}`}>
                    <Button variant="ghost" onClick={() => setSelectedId(hire.context.job_id)}
                      aria-label={`Ver contratação de ${hire.context.worker_name}: ${heading(hire)}`}
                      className="absolute inset-0 z-0 rounded-[1.125rem]" />
                    <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">{heading(hire)}</p>
                    <div>
                      <h2 className="truncate text-base font-semibold text-gray-950">{hire.context.worker_name}</h2>
                      <p className="mt-0.5 text-sm text-gray-600">{hours(hire)}</p>
                    </div>
                    <Badge tone={hire.tone}>{hire.label}</Badge>
                    {hire.state === 'checkout_code' && hire.context.code
                      ? <p className="relative z-10 w-fit select-all font-mono text-3xl font-bold tracking-widest text-gray-950">{hire.context.code}</p>
                      : null}
                    {hire.detail && <p className="text-sm text-gray-600">{hire.detail}</p>}
                    {(hire.action || (hire.state === 'checkout_code' && hire.context.code)) && <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3">
                      {hire.state === 'checkout_code' && hire.context.code ? <CopyCode code={hire.context.code} /> : <NextAction hire={hire} />}
                    </div>}
                  </article>
                </li>)}
              </ul>}
      </section>

      {selected && <div className="fixed inset-0 z-50 bg-gray-950/40" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null); }}>
        <aside role="dialog" aria-modal="true" aria-labelledby="hire-heading"
          className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-96 md:rounded-none">
          <div className="flex min-h-14 items-center justify-between border-b border-gray-200 px-5">
            <h2 id="hire-heading" className="text-sm font-semibold">Contratação</h2>
            <Button variant="ghost" aria-label="Fechar detalhes" onClick={() => setSelectedId(null)} className="px-3 text-xl">×</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">{heading(selected)}</p>
              <p className="text-lg font-semibold">{selected.context.worker_name}</p>
              <p className="text-sm text-gray-600">{hours(selected)}</p>
              <div className="pt-2"><Badge tone={selected.tone}>{selected.label}</Badge></div>
              {selected.detail && <p className="pt-1 text-sm text-gray-600">{selected.detail}</p>}
            </div>
            {selected.state === 'checkout_code' && selected.context.code && <div role="status" className="space-y-3 rounded-xl border border-orange-200 p-4">
              <p className="text-xs text-gray-600">Código de checkout</p>
              <p className="select-all font-mono text-3xl font-bold tracking-widest">{selected.context.code}</p>
              <CopyCode code={selected.context.code} />
            </div>}
            <section aria-labelledby="timeline-heading">
              <h3 id="timeline-heading" className="text-sm font-semibold">Linha do tempo</h3>
              <ol className="mt-3 space-y-2.5">
                {hireTimeline(selected, now).map((step) => <li key={step.label}
                  className={`flex items-center justify-between text-sm ${step.status === 'pending' ? 'text-gray-400' : step.status === 'incident' ? 'text-red-700' : 'text-gray-800'}`}>
                  <span className={step.status === 'current' ? 'font-semibold' : ''}>{step.label}</span>
                  <span aria-label={step.status === 'done' ? 'concluído' : step.status === 'current' ? 'em andamento' : step.status === 'incident' ? 'ocorrência' : 'pendente'}>{timelineIcon[step.status]}</span>
                </li>)}
              </ol>
            </section>
          </div>
          {selected.action && <div className="border-t border-gray-200 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">Próxima ação</p>
            <NextAction hire={selected} full />
          </div>}
        </aside>
      </div>}

      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
