'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, EmptyState, LoadingSkeleton, TextArea, TextInput, Toast } from '@/app/components/ui';
import { DemandActions } from '@/app/components/demand-card';
import DemandPersonSummary from '@/app/components/demand-person';
import DemandTalentNetwork from '@/app/components/demand-talent-network';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { createClient } from '@/lib/supabase/client';
import { buildDemands, canHireDemand, canRecruitDemand, demandDate, demandWindow, loadDemands, readDemandPages, recruitmentWindow, type Demand, type DemandApplication, type DemandReserve } from '@/lib/demands';
import { demandMapLinks, eventLabels, loadDemandPeople, shareDemand, signDemandPhotos, uniqueDemandCandidates, type DemandEvent, type DemandPerson } from '@/lib/demand-detail';
import { loadOperationalAssignments, loadPendingReviews, operationNextAction, type OperationalAssignment, type PendingReview } from '@/lib/operations';
import { ReputationDetails } from '@/app/components/operational-reputation';
import OperationFlow from '@/app/components/operation-flow';

function DemandEditor({ demand, duplicate }: { demand: Demand; duplicate: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(demand.job.title);
  const [description, setDescription] = useState(demand.job.description);
  const [date, setDate] = useState(demand.job.job_date);
  const [start, setStart] = useState(demand.job.start_time.slice(0, 5));
  const [end, setEnd] = useState(demand.job.end_time.slice(0, 5));
  const [value, setValue] = useState(String(demand.job.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const publicationWindow = recruitmentWindow({ job_date: date, start_time: start, end_time: end,
    created_at: duplicate ? new Date().toISOString() : demand.job.created_at });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { data, error } = await createClient().rpc('manage_restaurant_demand', {
        p_demand_id: demand.id, p_action: duplicate ? 'duplicate' : 'edit',
        p_title: title, p_description: description, p_job_date: date,
        p_start_time: start, p_end_time: end, p_value: Number(value),
        p_expected_revision: demand.job.demand_revision,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== 'string') throw new Error('O serviço não confirmou a operação salva.');
      router.push(`/restaurant/demands/${data}`);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível salvar a operação.');
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={(event) => void save(event)} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-xl font-semibold">{duplicate ? 'Duplicar operação' : 'Editar operação'}</h2>
      <p className="text-sm leading-6 text-gray-500">{duplicate ? 'Confira a data antes de publicar. O local e a quantidade serão copiados; a equipe e as candidaturas não.' : 'As alterações serão aplicadas a todos os profissionais necessários. O local e a quantidade serão mantidos.'}</p>
      {error && <Toast tone="error">{error}</Toast>}
      {publicationWindow.urgent && publicationWindow.start > new Date() && <Toast tone="info">Publicação urgente: a janela de recrutamento é reduzida e encerra no início da operação.</Toast>}
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <label className="block text-sm font-medium">Nome<TextInput required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1" /></label>
        <label className="block text-sm font-medium">Descrição<TextArea required value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1" /></label>
        <label className="block text-sm font-medium">Data<TextInput required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">Início<TextInput required type="time" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1" /></label>
          <label className="block text-sm font-medium">Fim<TextInput required type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1" /></label>
        </div>
        <label className="block text-sm font-medium">Diária (R$)<TextInput required type="number" min="0.01" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} className="mt-1" /></label>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" type="submit" busy={busy} className="px-5">{duplicate ? 'Publicar nova operação' : 'Salvar alterações'}</Button>
          <Link href={`/restaurant/demands/${demand.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold">Voltar</Link>
        </div>
      </fieldset>
    </form>
  );
}

export default function DemandDetail({ demandId }: { demandId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const action = searchParams.get('action');
  const [supabase] = useState(() => createClient());
  const [storedDemand, setDemand] = useState<Demand | null>(null);
  const [reserves, setReserves] = useState<DemandReserve[]>([]);
  const [people, setPeople] = useState<DemandPerson[]>([]);
  const [events, setEvents] = useState<DemandEvent[]>([]);
  const [operations, setOperations] = useState<OperationalAssignment[]>([]);
  const [replacementInvites, setReplacementInvites] = useState<Array<{ worker_id: string; status: string; replacement_assignment_id: string | null }>>([]);
  const [operationsError, setOperationsError] = useState('');
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [confirmHiring, setConfirmHiring] = useState<DemandApplication | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [peopleError, setPeopleError] = useState('');
  const [mapAllowed, setMapAllowed] = useState(false);
  const [eventLimit, setEventLimit] = useState(10);
  const [now, setNow] = useState(() => new Date());
  const demand = storedDemand ? buildDemands(storedDemand.jobs, storedDemand.applications, reserves, now)[0] : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const view = searchParams.get('view');
  const personId = searchParams.get('person');
  const base = `/restaurant/demands/${demandId}`;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!storedDemand) return;
    const jobIds = storedDemand.jobs.map((job) => job.id);
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const [assignments, data, invitations] = await Promise.all([
          loadOperationalAssignments(supabase, jobIds),
          loadDemands(supabase, demandId),
          readDemandPages<{ worker_id: string; status: string; replacement_assignment_id: string | null }>((offset) => supabase.from('demand_invitations')
            .select('worker_id, status, replacement_assignment_id').eq('demand_id', demandId).order('id').range(offset, offset + 499)),
        ]);
        if (active) {
          setOperations(assignments); setOperationsError(''); setNow(new Date());
          setDemand(buildDemands(data.jobs, data.applications, data.reserves)[0] ?? null);
          setReserves(data.reserves); setReplacementInvites(invitations);
        }
      } catch (error) {
        if (active) setOperationsError(error instanceof Error ? error.message : 'Não foi possível atualizar as etapas operacionais.');
      } finally { refreshing = false; }
    }
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [storedDemand, supabase, demandId]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError('');
      setHistoryError('');
      setPeopleError('');
      setOperationsError('');
      try {
        const data = await loadDemands(supabase, demandId);
        if (mounted) {
          setDemand(buildDemands(data.jobs, data.applications, data.reserves)[0] ?? null);
          setReserves(data.reserves);
        }
        const results = await Promise.allSettled([
          loadDemandPeople(supabase, demandId, view === 'profile' && personId ? personId : undefined, view !== 'profile'),
          readDemandPages<DemandEvent>((offset) => supabase.from('demand_events').select('id, kind, worker_id, occurred_at')
            .eq('demand_id', demandId).order('occurred_at', { ascending: false }).order('id').range(offset, offset + 499)),
          loadOperationalAssignments(supabase, data.jobs.map((job) => job.id)),
          loadPendingReviews(supabase),
          readDemandPages<{ worker_id: string; status: string; replacement_assignment_id: string | null }>((offset) => supabase.from('demand_invitations')
            .select('worker_id, status, replacement_assignment_id').eq('demand_id', demandId).order('id').range(offset, offset + 499)),
        ]);
        if (!mounted) return;
        if (results[0].status === 'fulfilled') {
          const loaded = results[0].value;
          setPeople(loaded);
          try {
            const signed = await signDemandPhotos(supabase, loaded);
            if (mounted) setPeople(signed);
          } catch (error) {
            if (mounted) setPeopleError(error instanceof Error ? error.message : 'Não foi possível carregar fotos.');
          }
        } else {
          setPeople([]);
          setPeopleError('Não foi possível carregar os perfis. Atualize para tentar novamente.');
        }
        if (results[1].status === 'fulfilled') setEvents(results[1].value);
        else {
          setEvents([]);
          setHistoryError('Não foi possível carregar a linha do tempo.');
        }
        if (results[2].status === 'fulfilled') setOperations(results[2].value);
        else { setOperations([]); setOperationsError('Não foi possível carregar check-in, pagamento e checkout. Atualize a operação.'); }
        if (results[3].status === 'fulfilled') setPendingReviews(results[3].value.filter((review) => data.jobs.some((job) => job.id === review.job_id)));
        else setOperationsError('Não foi possível conferir as avaliações pendentes. Atualize a operação.');
        if (results[4].status === 'fulfilled') setReplacementInvites(results[4].value);
        else setOperationsError('Não foi possível conferir os convites de substituição. Atualize a operação.');
      } catch (error) {
        if (mounted) setError(error instanceof Error ? error.message : 'Não foi possível carregar a operação.');
      } finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, [demandId, retry, supabase, action, view, personId]);

  const act = async (application: DemandApplication, operation: 'hire' | 'reserve' | 'remove') => {
    if (busy) return;
    setBusy(application.worker_id);
    setActionError('');
    setNotice('');
    try {
      const result = operation === 'hire'
        ? await supabase.rpc('approve_demand_candidate', { p_demand_id: demandId, p_worker_id: application.worker_id })
        : await supabase.rpc('set_demand_reserve', { p_demand_id: demandId, p_worker_id: application.worker_id, p_enabled: operation === 'reserve' });
      if (result.error) throw new Error(result.error.message);
      setNotice(operation === 'hire' ? 'Profissional contratado.' : operation === 'reserve' ? 'Profissional adicionado à reserva. Combine a disponibilidade com ele.' : 'Profissional removido da reserva.');
      if (operation === 'hire') {
        setConfirmHiring(null);
        router.push(`${base}#hired-heading`);
      }
      setRetry((value) => value + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível atualizar a equipe.');
    } finally { setBusy(null); }
  };

  const personById = new Map(people.map((person) => [person.id, person]));
  const candidates = demand ? uniqueDemandCandidates(demand) : [];
  const hired = demand ? [...new Map(demand.applications.filter((application) => ['approved', 'in_progress', 'completed'].includes(application.status)).map((application) => [application.worker_id, application])).values()] : [];
  const interrupted = [...operations].filter((operation) => operation.interruption && !operation.replacement_closed_at
    && !operations.some((current) => current.job_id === operation.job_id && !current.interruption))
    .sort((a, b) => (b.interrupted_at ?? '').localeCompare(a.interrupted_at ?? ''))[0];
  const reserveActive = Boolean(demand && !demand.archived && !demand.cancelled && demandWindow(demand.job).end > now && interrupted?.replacement_requested_at);
  const alternatives = [...candidates].filter((candidate) => interrupted?.interrupted_at && candidate.created_at
    && new Date(candidate.created_at) < new Date(interrupted.interrupted_at)
    && !operations.some((operation) => operation.worker_id === candidate.worker_id && operation.job_id === candidate.job_id)).sort((a, b) =>
    (personById.get(b.worker_id)?.reputation?.score ?? -1) - (personById.get(a.worker_id)?.reputation?.score ?? -1)
    || (personById.get(b.worker_id)?.completed_operations ?? 0) - (personById.get(a.worker_id)?.completed_operations ?? 0));
  const maps = demand ? demandMapLinks(demand) : null;
  const canHire = demand && canHireDemand(demand, now);
  const recruiting = Boolean(demand && canRecruitDemand(demand, now));
  const canConfirmHire = Boolean(confirmHiring && (canHire || (reserveActive && replacementInvites.some((invite) =>
    invite.worker_id === confirmHiring.worker_id && invite.replacement_assignment_id === interrupted?.id && invite.status === 'accepted'))));
  const pendingOperation = operationsError ? undefined : operations.find((operation) => !operation.interruption && !operation.checkout_at);
  const nextAction = pendingReviews.length ? { label: 'Avaliar experiência', href: `/reviews/${pendingReviews[0].job_id}` }
    : reserveActive ? { label: 'Confirmar substituição', href: '#reserve-heading' }
    : pendingOperation && demand ? operationNextAction(pendingOperation, demandWindow(demand.job).start, demandWindow(demand.job).end, 'restaurant', now)
    : interrupted ? { label: 'Decidir sobre a ocorrência', href: '#reserve-heading' }
    : { label: candidates.length ? 'Analisar candidatos' : recruiting ? 'Convidar profissionais' : 'Ver histórico',
      href: candidates.length ? `${base}?view=candidates` : recruiting ? `${base}?view=talents` : '#timeline-heading' };
  const replacementAction = async (operation: 'close_interrupted' | 'seek_replacement' | 'invite', workerId?: string) => {
    if (busy) return;
    setBusy(workerId ?? operation); setActionError(''); setNotice('');
    try {
      const { error } = operation === 'invite'
        ? await supabase.rpc('invite_demand_worker', { p_demand_id: demandId, p_worker_id: workerId })
        : await supabase.rpc('manage_restaurant_demand', { p_demand_id: demandId, p_action: operation });
      if (error) throw new Error(error.message);
      setNotice(operation === 'invite' ? 'Convite de substituição enviado. Aguarde o aceite antes de confirmar.' : operation === 'seek_replacement'
        ? 'Busca de substituto iniciada, sem reabrir o recrutamento.' : 'Operação encerrada. Histórico preservado.');
      setRetry((value) => value + 1);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Não foi possível registrar a decisão.'); }
    finally { setBusy(null); }
  };
  const profile = personId ? personById.get(personId) : null;
  const renderCandidate = (application: DemandApplication, reserveOnly = false) => {
    const person = personById.get(application.worker_id);
    const invitation = replacementInvites.find((invite) => invite.worker_id === application.worker_id && invite.replacement_assignment_id === interrupted?.id);
    return <article key={application.worker_id} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      {person ? <DemandPersonSummary person={person} role={demand?.job.title} profileHref={`${base}?view=profile&person=${person.id}`} /> : <p className="text-sm text-gray-500">Perfil não disponível. Os dados não foram compartilhados ou a conta foi excluída.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {person && <Link href={`${base}?view=profile&person=${person.id}`} className="mr-auto inline-flex min-h-11 items-center text-xs font-semibold">Ver Perfil</Link>}
        {(reserveOnly ? reserveActive && invitation?.status === 'accepted' : canHire) && <Button variant="primary" disabled={busy !== null || !person} onClick={() => setConfirmHiring(application)} className="px-3 text-xs">{reserveOnly ? 'Confirmar Substituição' : 'Contratar'}</Button>}
        {reserveOnly && invitation?.status !== 'accepted' && <Button disabled={busy !== null || !person || Boolean(invitation)} onClick={() => void replacementAction('invite', application.worker_id)} className="px-3 text-xs">{invitation?.status === 'pending' ? 'Aguardando aceite' : invitation?.status === 'declined' ? 'Convite recusado' : 'Convidar para substituição'}</Button>}
      </div>
    </article>;
  };
  const share = async () => {
    if (!demand) return;
    setActionError(''); setNotice('');
    try { setNotice(await shareDemand(demand)); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setActionError('Não foi possível compartilhar a operação. Confira as permissões do navegador.');
    }
  };
  const separateHistory = !historyError && (events.length > 1 || (events.length === 1 && events[0].kind !== 'created'));
  const history = <section aria-labelledby="timeline-heading" className={separateHistory ? 'space-y-4 rounded-2xl border border-gray-200 bg-white p-5' : 'space-y-2 border-t border-gray-100 pt-4'}>
    <h2 id="timeline-heading" className={separateHistory ? 'text-xl font-semibold' : 'text-sm font-semibold'}>Linha do tempo</h2>
    {historyError ? <Toast tone="error"><p>{historyError}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 underline">Tentar Novamente</Button></Toast> : events.length ? <ol className="space-y-0">
      {events.slice(0, eventLimit).map((event) => <li key={event.id} className="relative border-l border-gray-200 pb-6 pl-5 last:pb-0">
        <span aria-hidden="true" className="absolute -left-1 top-1 size-2 rounded-full bg-orange-700" />
        <time dateTime={event.occurred_at} className="text-[11px] text-gray-500">{new Date(event.occurred_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
        <p className="mt-1 text-sm font-medium">{eventLabels[event.kind] ?? 'Operação atualizada'}</p>
        {event.worker_id && <p className="mt-0.5 text-xs text-gray-500">{personById.get(event.worker_id)?.name ?? 'Profissional'}</p>}
      </li>)}
    </ol> : <p className="text-sm text-gray-500">Nenhum evento registrado nesta operação.</p>}
    {events.length > eventLimit && <Button onClick={() => setEventLimit((value) => value + 20)} className="px-4 text-xs">Ver histórico completo</Button>}
  </section>;
  const heading = view === 'talents' ? 'Rede de Talentos' : view === 'candidates' ? 'Candidatos' : view === 'profile' ? 'Perfil do profissional' : demand?.job.title ?? 'Detalhes da Operação';
  return (
    <main className="min-h-screen bg-[#fafaf9] px-5 py-6 pb-28 text-gray-950 sm:px-8">
      <section className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={view || action ? base : '/restaurant/demands'} className="inline-flex min-h-11 items-center text-xs font-semibold text-gray-600">← {view || action ? 'Voltar à operação' : 'Voltar'}</Link>
            <h1 className="mt-2 break-words text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{heading}</h1>
          </div>
          {demand && !loading && <details className="relative z-20 mt-1">
            <summary aria-label="Ações da operação" className="grid size-11 cursor-pointer list-none place-items-center rounded-full border border-gray-200 bg-white text-xl">···</summary>
            <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-gray-200 bg-white p-4 shadow-xl">
              <DemandActions demand={demand} detailed onChanged={() => setRetry((value) => value + 1)} />
              {!demand.completed && !demand.cancelled && <p className="mt-3 text-xs leading-5 text-gray-500">Arquivar Operação disponível após concluir ou cancelar.</p>}
            </div>
          </details>}
        </header>
        {loading ? <LoadingSkeleton label="Carregando operação..." /> : error ? (
          <Toast tone="error" title="Não foi possível carregar esta operação."><p>{error}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="mt-2 px-0 underline">Tentar Novamente</Button></Toast>
        ) : !demand ? <EmptyState title="Operação não encontrada." description="Ela pode não estar disponível para sua conta." /> : action === 'duplicate' || (action === 'edit' && demand.canEdit) ? (
          <DemandEditor key={`${demand.id}-${action}`} demand={demand} duplicate={action === 'duplicate'} />
        ) : view === 'talents' ? <DemandTalentNetwork demandId={demandId} canInvite={recruiting} /> : view === 'profile' ? (
          <section className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5">
            {peopleError && <Toast tone="error">{peopleError}</Toast>}
            {profile ? <>
              <DemandPersonSummary person={profile} />
              {profile.reputation && <ReputationDetails reputation={profile.reputation} />}
              <h2 className="font-semibold">Experiência</h2>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{profile.experience || 'Experiência não compartilhada pelo profissional.'}</p>
              <p className="text-xs text-gray-500">{profile.completed_operations} operações concluídas com sua empresa.</p>
              <Link href={`${base}?view=talents`} className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-800">Convidar pela Rede de Talentos →</Link>
            </> : <p className="text-sm text-gray-500">Perfil indisponível para esta conta.</p>}
          </section>
        ) : view === 'candidates' ? (
          <section className="space-y-4">
            <p className="text-sm text-gray-500">{candidates.length} candidatos aguardando decisão</p>
            {peopleError && <Toast tone="info">{peopleError}</Toast>}
            {actionError && <Toast tone="error">{actionError}</Toast>}
            {notice && <Toast tone="info">{notice}</Toast>}
            {candidates.length ? candidates.map((candidate) => renderCandidate(candidate)) : <EmptyState title="Ainda não há candidatos." description="Compartilhe a operação para encontrar ajuda."
              action={<Button variant="primary" onClick={() => void share()} className="px-4">Compartilhar Operação</Button>} />}
          </section>
        ) : (
          <>
            {action === 'edit' && <Toast tone="info">Esta operação já possui candidaturas ou foi iniciada. Não é possível editar os dados combinados com a equipe.</Toast>}
            {demand.archived && <Toast tone="info">Operação arquivada. Você pode restaurá-la pelo menu de ações.</Toast>}
            <section aria-labelledby="summary-heading" className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="summary-heading" className="text-xs font-semibold uppercase tracking-widest text-gray-500">Informações da Operação</h2>
                <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${demand.health === 'risk' ? 'bg-red-50 text-red-800' : demand.health === 'safe' ? 'bg-emerald-50 text-emerald-800' : 'bg-orange-50 text-orange-900'}`}>{demand.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-gray-500">Data</p><p className="mt-1 font-semibold">{demandDate(demand.job.job_date, now)}</p><time dateTime={demand.job.job_date} className="mt-1 block text-xs text-gray-500">{demand.job.job_date.split('-').reverse().join('/')}</time></div>
                <div><p className="text-xs text-gray-500">Horário</p><p className="mt-1 font-medium">{demand.job.start_time.slice(0, 5)} às {demand.job.end_time.slice(0, 5)}{demandWindow(demand.job).start.toDateString() !== demandWindow(demand.job).end.toDateString() ? ' (+1 dia)' : ''}</p></div>
                <div className="min-w-0"><p className="text-xs text-gray-500">Valor da diária</p><p className="mt-1 break-words text-xl font-semibold tracking-tight">{Number(demand.job.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p></div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <a href="#team-heading" className="block min-w-0 rounded-xl bg-gray-50 p-3 text-sm">
                  {hired.length ? <>
                    <span className="block font-semibold">Profissional da Operação</span>
                    <span className="text-gray-600">Contratação confirmada</span>
                  </> : <>
                    <span className="block text-xl font-semibold">{candidates.length}</span>
                    <span className="text-gray-600">Candidatos</span>
                  </>}
                </a>
              </div>
              <section aria-labelledby="location-heading" className="space-y-2 border-t border-gray-100 pt-4">
                <h3 id="location-heading" className="scroll-mt-6 text-sm font-semibold">Local da Operação</h3>
                <p className="break-words text-sm font-medium">{demand.job.location_name || 'Local a definir'}</p>
                <address className="space-y-1 break-words text-sm leading-6 text-gray-500 not-italic">
                  <p>{[demand.job.work_address, demand.job.work_number, demand.job.work_neighborhood].filter(Boolean).join(', ') || 'Endereço ainda não informado.'}</p>
                  {(demand.job.work_city || demand.job.work_state || demand.job.work_postal_code) && <p>{[[demand.job.work_city, demand.job.work_state].filter(Boolean).join(' / '), demand.job.work_postal_code].filter(Boolean).join(' · ')}</p>}
                </address>
                {maps?.map && (mapAllowed ? <iframe title="Mapa do local da operação" src={maps.map} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts" className="h-44 w-full rounded-xl border-0" /> : <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs leading-5 text-gray-500">Carregar o mapa conecta seu navegador ao OpenStreetMap.</p><Button onClick={() => setMapAllowed(true)} className="mt-2 px-3 text-xs">Carregar mapa</Button></div>)}
                {maps?.route && <a href={maps.route} target="_blank" rel="noopener noreferrer" className="ec-button ec-button--secondary px-4 text-sm">Abrir rota ↗</a>}
              </section>
              <section aria-labelledby="notes-heading" className="space-y-2 border-t border-gray-100 pt-4">
                <h3 id="notes-heading" className="text-sm font-semibold">Observações</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{demand.job.description?.trim() || 'Nenhuma observação adicionada.'}</p>
              </section>
              {!separateHistory && history}
            </section>
            {actionError && <Toast tone="error">{actionError}</Toast>}
            {notice && <Toast tone="info">{notice}</Toast>}
            <section aria-labelledby="operation-flow-heading" className="space-y-3">
              <h2 id="operation-flow-heading" className="scroll-mt-6 text-xl font-semibold">Fluxo operacional</h2>
              {operationsError && <Toast tone="error">{operationsError}</Toast>}
              {hired.length ? hired.map((application) => {
                const operation = operations.find((item) => item.job_id === application.job_id && item.worker_id === application.worker_id);
                return <div key={application.job_id} className="space-y-2">
                  <p className="break-words text-sm font-semibold">{personById.get(application.worker_id)?.name ?? 'Profissional'}</p>
                  <OperationFlow jobId={application.job_id} role="restaurant" hired assignment={operationsError ? null : operation ?? null}
                    startsAt={demandWindow(demand.job).start} endsAt={demandWindow(demand.job).end} now={now} />
                </div>;
              }) : <OperationFlow jobId={demand.job.id} role="restaurant" hired={false} assignment={null}
                startsAt={demandWindow(demand.job).start} endsAt={demandWindow(demand.job).end} now={now} />}
              {nextAction.href !== `${base}?view=talents` && (!pendingOperation || pendingReviews.length > 0 || reserveActive) &&
                <Link href={nextAction.href} className="ec-button ec-button--primary px-4 text-sm">{nextAction.label}</Link>}
            </section>
            <section id="team-heading" aria-labelledby="people-heading" className="scroll-mt-6 space-y-5 rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="people-heading" className="text-xl font-semibold">{hired.length ? 'Profissional da Operação' : 'Candidatos'}</h2>
                {!hired.length && recruiting && <Link href={`${base}?view=talents`} className="ec-button ec-button--primary px-4 text-sm">Convidar profissionais</Link>}
              </div>
              {peopleError && <Toast tone="info">{peopleError}</Toast>}
              {!hired.length ? <section id="candidates-heading" aria-labelledby="people-heading" className="scroll-mt-6 space-y-3 border-t border-gray-100 pt-4">
                <Link href={`${base}?view=candidates`} className="inline-flex min-h-11 items-center text-xs font-semibold text-orange-800">Ver todos ({candidates.length})</Link>
                {candidates.length ? candidates.slice(0, 3).map((candidate) => renderCandidate(candidate)) : <div className="rounded-xl bg-gray-50 p-4">
                  <p className="text-sm font-medium">Nenhum candidato ainda</p>
                  <p className="mt-1 text-sm leading-6 text-gray-500">{recruiting ? 'Convide profissionais ou compartilhe a operação para receber candidaturas.' : 'O recrutamento foi encerrado. A operação permanece disponível para gestão e histórico.'}</p>
                  <Button variant="ghost" onClick={() => void share()} className="mt-2 px-0 text-xs">Compartilhar Operação</Button>
                </div>}
              </section> : <section id="hired-heading" aria-labelledby="people-heading" className="scroll-mt-6 space-y-3 border-t border-gray-100 pt-4">
                {hired.map((application) => {
                  const person = personById.get(application.worker_id);
                  const checkout = events.some((event) => event.kind === 'checkout' && event.worker_id === application.worker_id);
                  const checkin = events.some((event) => event.kind === 'checkin' && event.worker_id === application.worker_id);
                  const status = application.status === 'completed' ? 'Concluído' : checkout ? 'Checkout Realizado' : application.status === 'in_progress' ? now >= demandWindow(demand.job).end ? 'Trabalho encerrado' : 'Trabalho em andamento' : checkin ? 'Check-in Realizado' : 'Confirmado';
                  return <article key={application.worker_id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
                    {person ? <DemandPersonSummary person={person} role={demand.job.title} profileHref={`${base}?view=profile&person=${person.id}`} /> : <p className="text-sm text-gray-500">Profissional · perfil indisponível</p>}
                    <p className="text-xs font-medium text-emerald-800">{status}{checkin && status !== 'Check-in Realizado' ? ' · Check-in Realizado' : ''}{checkout && status !== 'Checkout Realizado' ? ' · Checkout Realizado' : ''}</p>
                    <div className="flex flex-wrap gap-4">
                      <a href="#operation-flow-heading" className="inline-flex min-h-11 items-center text-xs font-semibold text-orange-800">Ver etapa e ações</a>
                      {application.status === 'completed' && <Link href={`/reviews/${application.job_id}`} className="inline-flex min-h-11 items-center text-xs font-semibold">Avaliar profissional</Link>}
                    </div>
                  </article>;
                })}
              </section>}
              <details className="border-t border-gray-100 pt-4">
                <summary className="cursor-pointer py-2 text-sm font-medium text-gray-600">Outras ações</summary>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => void share()} className="px-3 text-sm">Compartilhar Operação</Button>
                  {demand.canEdit && <Link href={`${base}?action=edit`} className="inline-flex min-h-11 items-center text-sm font-semibold text-gray-600">Editar</Link>}
                  <Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 text-xs text-gray-500">Atualizar operação</Button>
                </div>
              </details>
            </section>
            {interrupted && !demand.cancelled && <section aria-labelledby="reserve-heading" className="space-y-4">
              <h2 id="reserve-heading" className="scroll-mt-6 text-xl font-semibold">Substituição · candidatos e reserva</h2>
              <p className="text-sm text-gray-600">Ocorrência registrada. Decida entre encerrar a operação ou convidar candidatos vinculados antes da ocorrência. O recrutamento permanece encerrado.</p>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy !== null} onClick={() => void replacementAction('close_interrupted')} className="px-4">Encerrar operação</Button>
                {!reserveActive && demandWindow(demand.job).end > now && !demand.archived && <Button variant="primary" disabled={busy !== null} onClick={() => void replacementAction('seek_replacement')} className="px-4">Buscar substituto</Button>}
              </div>
              {reserveActive && (alternatives.length ? alternatives.map((candidate, index) => <div key={candidate.worker_id} className="space-y-2">
                {index === 0 && <p className="text-xs font-semibold text-orange-800">Primeira alternativa para analisar · confirme a disponibilidade</p>}
                {renderCandidate(candidate, true)}
              </div>) : <p className="text-sm text-gray-500">Nenhum candidato elegível para substituição. O recrutamento não será reaberto.</p>)}
              <p className="text-xs leading-5 text-gray-500">O aceite do convite indica disponibilidade. A contratação exige confirmação explícita do restaurante antes do término da operação.</p>
            </section>}
            {separateHistory && history}
          </>
        )}
      </section>
      {confirmHiring && <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} aria-labelledby="confirm-hiring-heading" onCancel={(event) => { if (busy) event.preventDefault(); else setConfirmHiring(null); }} className="m-auto w-[calc(100%-2rem)] max-w-lg space-y-5 rounded-2xl border border-gray-200 bg-white p-6 text-gray-950 backdrop:bg-black/40">
        <h2 id="confirm-hiring-heading" className="text-xl font-semibold">Confirmar Contratação</h2>
        {personById.get(confirmHiring.worker_id) && <DemandPersonSummary person={personById.get(confirmHiring.worker_id)!} role={demand?.job.title} />}
        <p className="text-sm text-gray-600">Ao confirmar, o profissional entra na equipe e o chat fica disponível.</p>
        {!canConfirmHire && <p role="status" className="text-sm text-gray-600">A contratação não está mais disponível nesta etapa da operação.</p>}
        {actionError && <Toast tone="error">{actionError}</Toast>}
        <div className="flex flex-wrap gap-3">
          <Button autoFocus disabled={busy !== null} onClick={() => setConfirmHiring(null)} className="px-4">Cancelar</Button>
          <Button variant="primary" disabled={!canConfirmHire} busy={busy !== null} onClick={() => void act(confirmHiring, 'hire')} className="px-4">Confirmar Contratação</Button>
        </div>
      </dialog>}
      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
