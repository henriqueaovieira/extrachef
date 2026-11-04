'use client';

import { useEffect, useState } from 'react';
import { Button, LoadingSkeleton, Toast } from '@/app/components/ui';
import { createClient } from '@/lib/supabase/client';
import type { OperationalReputation } from '@/lib/operations';

export function ReputationDetails({ reputation }: { reputation: OperationalReputation }) {
  return <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Confiança operacional</h2>
    <p className="text-2xl font-semibold">{Number(reputation.score).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} / 100</p>
    <p className="text-sm font-medium text-orange-800">{reputation.classification}</p>
    {reputation.completed < 5 && <p className="text-xs text-gray-600">Score inicial de 70. O cálculo completo é ativado após cinco trabalhos com check-in, recebimento confirmado e checkout.</p>}
    <dl className="grid grid-cols-2 gap-4 text-sm">
      {([
        ['Pontualidade', reputation.punctuality === null ? 'Sem compromissos registrados' : `${Number(reputation.punctuality).toLocaleString('pt-BR')}%`],
        ['Avaliação média', reputation.average_rating === null ? 'Sem avaliações' : `${Number(reputation.average_rating).toLocaleString('pt-BR')} / 5`],
        ['Trabalhos concluídos', reputation.completed], ['Recontratações', reputation.rehires],
        ['Presença (check-ins)', reputation.checkins], ['Checkouts', reputation.checkouts], ['Antecipações', reputation.early],
        ['Pontuais', reputation.on_time], ['Atrasos', reputation.late], ['Ausências', reputation.absences],
        ['Cancelamentos em 90 dias', reputation.cancellations_90d], ['Abandonos em 180 dias', reputation.abandonments_180d],
      ] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-gray-500">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
    </dl>
    <p className="text-xs leading-5 text-gray-500">Indicadores calculados a partir de registros operacionais. Confiabilidade não é uma probabilidade estatística nem uma garantia de comparecimento.</p>
  </section>;
}

export default function OperationalReputationView({ workerId, summary = false }: { workerId?: string; summary?: boolean }) {
  const [supabase] = useState(() => createClient());
  const [reputation, setReputation] = useState<OperationalReputation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setError(''); setLoading(true);
        let id = workerId;
        if (!id) {
          const { data, error } = await supabase.auth.getUser();
          if (error || !data.user) throw new Error('Entre na sua conta para consultar a reputação.');
          id = data.user.id;
        }
        const { data, error } = await supabase.rpc('worker_operational_reputation', { p_worker_id: id });
        if (error) throw new Error(error.message);
        if (active) setReputation(data);
      } catch (error) {
        console.error('Operational reputation lookup failed.', error);
        if (active) setError('Não foi possível carregar sua confiança operacional.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [retry, supabase, workerId]);
  if (summary) {
    const cardClassName = 'flex min-h-32 min-w-0 flex-col justify-between rounded-2xl border border-gray-200 bg-white p-3 sm:p-5';
    if (loading) return <article className={cardClassName}><p className="break-words text-sm text-gray-500">—</p><p className="mt-1 break-words text-xs leading-4 text-gray-600 sm:text-sm">Confiança</p></article>;
    if (error) return <article className={cardClassName}>
      <p className="break-words text-sm text-gray-500">—</p>
      <p className="mt-1 break-words text-xs leading-4 text-gray-600 sm:text-sm">Confiança</p>
    </article>;
    if (!reputation) return <article className={cardClassName}>
      <p className="break-words text-sm text-gray-500">—</p>
      <p className="mt-1 break-words text-xs leading-4 text-gray-600 sm:text-sm">Confiança</p>
    </article>;
    return <article className={cardClassName}>
      <div>
        <p className="break-words text-2xl font-semibold tabular-nums text-gray-950">{Number(reputation.score).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}<span className="text-sm font-medium text-gray-500"> / 100</span></p>
        <p className="mt-1 break-words text-xs font-medium text-orange-800 sm:text-sm">{reputation.classification}</p>
      </div>
      <p className="mt-1 break-words text-xs leading-4 text-gray-600 sm:text-sm">Confiança</p>
    </article>;
  }
  return loading ? <LoadingSkeleton label="Carregando reputação..." /> : error ? <Toast tone="error"><p>{error}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 underline">Tentar novamente</Button></Toast>
    : reputation ? <ReputationDetails reputation={reputation} /> : <p className="text-sm text-gray-500">Indicadores não compartilhados pelo profissional.</p>;
}
