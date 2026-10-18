'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Toast } from '@/app/components/ui';
import { createClient } from '@/lib/supabase/client';
import { demandDate, demandWindow, type Demand } from '@/lib/demands';
import { shareDemand } from '@/lib/demand-detail';

const healthStyles = {
  safe: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-900',
  risk: 'bg-red-50 text-red-800',
  neutral: 'bg-gray-100 text-gray-600',
};

export function DemandSituation({ demand }: { demand: Demand }) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 border-y border-gray-100 py-4">
        {[['Equipe contratada', demand.hired], ['Candidatos', demand.candidates]].map(([label, count]) => (
          <div key={label}><dt className="text-[11px] text-gray-500 sm:text-xs">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{count}</dd></div>
        ))}
      </dl>
      <p className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs font-medium leading-5 ${healthStyles[demand.health]}`}>
        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-current" />{demand.healthLabel}
      </p>
    </>
  );
}

export function DemandActions({ demand, onChanged, detailed = false }: { demand: Demand; onChanged: () => void; detailed?: boolean }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const href = `/restaurant/demands/${demand.id}`;
  const share = async () => {
    setError('');
    setNotice('');
    try {
      setNotice(await shareDemand(demand));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setError('Não foi possível compartilhar. Confira as permissões do navegador e tente novamente.');
    }
  };
  const archive = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await createClient().rpc('archive_restaurant_demand', { p_demand_id: demand.id, p_archived: !demand.archived });
      if (error) throw new Error(error.message);
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível arquivar a demanda.');
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    setError('');
    try {
      const { error } = await createClient().rpc('manage_restaurant_demand', { p_demand_id: demand.id, p_action: 'cancel' });
      if (error) throw new Error(error.message);
      setConfirmCancel(false);
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível cancelar a demanda.');
    } finally { setBusy(false); }
  };
  return (
    <div className="relative z-10 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-gray-600">
        {demand.canEdit ? <Link href={`${href}?action=edit`} className="inline-flex min-h-11 items-center">{detailed ? 'Editar Demanda' : 'Editar'}</Link> : detailed ? <p className="text-xs font-normal leading-5">Edição indisponível após candidaturas ou início da operação.</p> : null}
        <Link href={`${href}?action=duplicate`} className="inline-flex min-h-11 items-center">{detailed ? 'Duplicar Demanda' : 'Duplicar'}</Link>
        <Button variant="ghost" onClick={() => void share()} className="min-h-11 px-0 text-xs">{detailed ? 'Compartilhar Demanda' : 'Compartilhar'}</Button>
        {demand.canCancel ? <Button variant="ghost" onClick={() => setConfirmCancel(true)} className="min-h-11 px-0 text-xs text-red-700">{detailed ? 'Cancelar Demanda' : 'Cancelar'}</Button> : detailed && demand.active ? <p className="text-xs font-normal leading-5">Cancelamento direto indisponível com profissionais contratados.</p> : null}
        {(demand.completed || demand.cancelled || demand.archived) && <Button variant="ghost" disabled={busy} onClick={() => void archive()} className="min-h-11 px-0 text-xs">{demand.archived ? 'Restaurar Demanda' : 'Arquivar Demanda'}</Button>}
      </div>
      {confirmCancel && <div className="rounded-xl border border-red-100 bg-red-50 p-3">
        <p className="text-sm text-red-900">Cancelar esta demanda? As candidaturas deixarão de aceitar contratações.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="danger" busy={busy} onClick={() => void cancel()} className="px-3 text-xs">Confirmar cancelamento</Button>
          <Button disabled={busy} onClick={() => setConfirmCancel(false)} className="px-3 text-xs">Manter demanda</Button>
        </div>
      </div>}
      {error && <Toast tone="error">{error}</Toast>}
      {notice && <Toast tone="info">{notice}</Toast>}
    </div>
  );
}

export default function DemandCard({ demand, onChanged }: { demand: Demand; onChanged: () => void }) {
  const { job } = demand;
  const { start, end } = demandWindow(job);
  const overnight = start.toDateString() !== end.toDateString();
  return (
    <article id={demand.id} className="relative flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm sm:p-6">
      <div>
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${healthStyles[demand.health]}`}>{demand.status}</span>
        <h2 className="mt-3 break-words text-xl font-semibold tracking-tight">
          <Link href={`/restaurant/demands/${demand.id}`} className="after:absolute after:inset-0 after:rounded-2xl">{job.title}</Link>
        </h2>
        <p className="mt-3 text-sm font-medium">{demandDate(job.job_date)} <span className="mx-1 text-gray-400">·</span> {job.start_time.slice(0, 5)} às {job.end_time.slice(0, 5)}{overnight ? ' (+1 dia)' : ''}</p>
        <p className="mt-1 break-words text-sm text-gray-500">{job.location_name || job.work_address || 'Local a definir'}{job.work_city ? ` · ${job.work_city}` : ''}</p>
      </div>
      <DemandSituation demand={demand} />
      <div className="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-2">
        <Link href={`/restaurant/demands/${demand.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-gray-900">Ver Detalhes <span aria-hidden="true" className="ml-2">→</span></Link>
        {demand.active && <Link href={`/restaurant/demands/${demand.id}#team-heading`} className="inline-flex min-h-11 items-center text-xs font-semibold text-orange-800">{demand.candidates ? 'Analisar candidatos' : demand.hired < demand.required ? 'Preencher equipe' : 'Ver equipe'}</Link>}
      </div>
      <details className="relative z-10 border-t border-gray-100 pt-1">
        <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold text-gray-500">Mais ações</summary>
        <DemandActions demand={demand} onChanged={onChanged} />
        {!demand.canEdit && !demand.cancelled && <p className="pb-2 text-xs leading-5 text-gray-500">Edição disponível apenas antes do início e sem candidaturas. Cancelamento direto apenas sem contratações.</p>}
      </details>
    </article>
  );
}
