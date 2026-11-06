'use client';

import Link from 'next/link';
import { useState, type ComponentProps } from 'react';
import { Badge, Button, Card, Toast } from '@/app/components/ui';
import { createClient } from '@/lib/supabase/client';
import { canHireDemand, canRecruitDemand, demandDate, demandWindow, type Demand } from '@/lib/demands';
import { shareDemand } from '@/lib/demand-detail';

const healthTones: Record<Demand['health'], ComponentProps<typeof Badge>['tone']> = {
  safe: 'info', warning: 'warning', risk: 'warning', neutral: 'neutral',
};
const statusTones: Record<string, ComponentProps<typeof Badge>['tone']> = {
  'Cancelada': 'neutral', 'Concluída': 'success', 'Checkout Pendente': 'warning',
  'Não preenchida': 'warning', 'Em Andamento': 'info', 'Profissional Contratado': 'info',
  'Equipe Completa': 'info', 'Equipe em formação': 'warning', 'Recrutamento encerrado': 'neutral',
  'Recebendo Candidaturas': 'warning', 'Buscando Profissionais': 'warning',
};

export function DemandSituation({ demand }: { demand: Demand }) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 border-y border-gray-100 py-4">
        {[['Equipe contratada', demand.hired], ['Candidatos', demand.candidates]].map(([label, count]) => (
          <div key={label} className="min-w-0"><dt className="text-xs text-gray-600">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{count}</dd></div>
        ))}
      </dl>
      <Badge tone={healthTones[demand.health]} className="ec-operation-status">{demand.healthLabel}</Badge>
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
      setError(error instanceof Error ? error.message : 'Não foi possível arquivar a operação.');
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
      setError(error instanceof Error ? error.message : 'Não foi possível cancelar a operação.');
    } finally { setBusy(false); }
  };
  return (
    <div className="relative z-10 space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-gray-600">
        {demand.canEdit ? <Link href={`${href}?action=edit`} className="inline-flex min-h-11 items-center">{detailed ? 'Editar Operação' : 'Editar'}</Link> : detailed ? <p className="text-xs font-normal leading-5">Edição indisponível após candidaturas ou início da operação.</p> : null}
        <Link href={`${href}?action=duplicate`} className="inline-flex min-h-11 items-center">{detailed ? 'Duplicar Operação' : 'Duplicar'}</Link>
        <Button variant="ghost" onClick={() => void share()} className="min-h-11 px-0 text-xs">{detailed ? 'Compartilhar Operação' : 'Compartilhar'}</Button>
        {demand.canCancel ? <Button variant="ghost" onClick={() => setConfirmCancel(true)} className="min-h-11 px-0 text-xs text-red-700">{detailed ? 'Cancelar Operação' : 'Cancelar'}</Button> : detailed && demand.active ? <p className="text-xs font-normal leading-5">Cancelamento direto indisponível com profissionais contratados.</p> : null}
        {(demand.completed || demand.cancelled || demand.archived) && <Button variant="ghost" disabled={busy} onClick={() => void archive()} className="min-h-11 px-0 text-xs">{demand.archived ? 'Restaurar Operação' : 'Arquivar Operação'}</Button>}
      </div>
      {confirmCancel && <div className="ec-operational-panel__danger space-y-3">
        <p className="text-sm">Cancelar esta operação? As candidaturas deixarão de aceitar contratações.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="danger" busy={busy} onClick={() => void cancel()} className="px-3 text-xs">Confirmar cancelamento</Button>
          <Button disabled={busy} onClick={() => setConfirmCancel(false)} className="px-3 text-xs">Manter operação</Button>
        </div>
      </div>}
      {error && <Toast tone="danger">{error}</Toast>}
      {notice && <Toast tone="info">{notice}</Toast>}
    </div>
  );
}

export default function DemandCard({ demand, onChanged }: { demand: Demand; onChanged: () => void }) {
  const { job } = demand;
  const { start, end } = demandWindow(job);
  const overnight = start.toDateString() !== end.toDateString();
  return (
    <Card as="article" id={demand.id} data-attention={demand.attention ? 'pending' : demand.completed || demand.cancelled || demand.archived ? 'closed' : demand.running ? 'running' : 'future'} className="ec-demand-card relative flex flex-col gap-4">
      <div>
        <Badge tone={demand.archived ? 'neutral' : statusTones[demand.status] ?? 'neutral'} className="ec-operation-status">{demand.status}</Badge>
        <h2 className="mt-3 break-words text-xl font-semibold tracking-tight">
          <Link href={`/restaurant/demands/${demand.id}`} className="ec-demand-card__title after:absolute after:inset-0 after:rounded-2xl">{job.title}</Link>
        </h2>
        <p className="mt-2 text-sm text-gray-700"><span className="font-semibold">Responsável:</span> {demand.active ? demand.running ? 'Restaurante e profissional · acompanhar a operação' : 'Restaurante · acompanhar equipe e contratação' : 'Restaurante · consultar encerramento e avaliações'}</p>
      </div>
      <div className="relative z-10 flex flex-col gap-3">
        <Link href={`/restaurant/demands/${demand.id}`} className={`ec-button px-4 text-sm ${demand.active ? 'ec-button--secondary' : 'ec-button--primary'}`}>{demand.completed || demand.cancelled ? 'Consultar encerramento da operação' : 'Acompanhar etapas da operação'} <span aria-hidden="true" className="ml-2">→</span></Link>
        {demand.active && <Link href={`/restaurant/demands/${demand.id}#people-heading`} className="ec-button ec-button--primary px-4 text-sm">{demand.candidates && canHireDemand(demand) ? 'Analisar candidatos' : canRecruitDemand(demand) ? 'Preencher equipe' : 'Acompanhar equipe da operação'}</Link>}
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600">Agenda da operação</p>
        <p className="mt-3 text-sm font-medium">{demandDate(job.job_date)} <span className="mx-1 text-gray-400">·</span> {job.start_time.slice(0, 5)} às {job.end_time.slice(0, 5)}{overnight ? ' (+1 dia)' : ''}</p>
        <p className="mt-2 break-words text-sm text-gray-600">{job.location_name || job.work_address || 'Local a definir'}{job.work_city ? ` · ${job.work_city}` : ''}</p>
      </div>
      <DemandSituation demand={demand} />
      <details className="relative z-10 border-t border-gray-100 pt-1">
        <summary className="min-h-12 cursor-pointer content-center text-xs font-semibold text-gray-600">Mais ações</summary>
        <DemandActions demand={demand} onChanged={onChanged} />
        {!demand.canEdit && !demand.cancelled && <p className="pb-2 text-xs leading-5 text-gray-500">Edição disponível apenas antes do início e sem candidaturas. Cancelamento direto apenas sem contratações.</p>}
      </details>
    </Card>
  );
}
