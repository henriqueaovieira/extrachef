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
import { buildDemands, demandDate, demandWindow, loadDemands, readDemandPages, type Demand, type DemandApplication, type DemandReserve } from '@/lib/demands';
import { demandAddress, demandMapLinks, eventLabels, loadDemandPeople, shareDemand, signDemandPhotos, uniqueDemandCandidates, type DemandEvent, type DemandPerson } from '@/lib/demand-detail';
import { loadOperationalAssignments, loadPendingReviews, operationNextAction, type OperationalAssignment, type PendingReview } from '@/lib/operations';
import { ReputationDetails } from '@/app/components/operational-reputation';

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
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
  const reserveActive = Boolean(demand && demandWindow(demand.job).end > now && operations.some((operation) => operation.replacement_job_id
    && demand.jobs.some((job) => job.id === operation.replacement_job_id && job.status === 'open')));
  const alternatives = [...candidates].sort((a, b) =>
    (personById.get(b.worker_id)?.reputation?.score ?? -1) - (personById.get(a.worker_id)?.reputation?.score ?? -1)
    || (personById.get(b.worker_id)?.completed_operations ?? 0) - (personById.get(a.worker_id)?.completed_operations ?? 0));
  const maps = demand ? demandMapLinks(demand) : null;
  const canHire = demand && demand.active && demand.jobs.some((job) => job.status === 'open') && demandWindow(demand.job).end > now;
  const canReserve = demand && reserveActive && demand.active && demandWindow(demand.job).start > now;
  const pendingOperation = operations.find((operation) => !operation.interruption && !operation.checkout_at);
  const nextAction = pendingReviews.length ? { label: 'Avaliar experiência', href: `/reviews/${pendingReviews[0].job_id}` }
    : reserveActive ? { label: 'Confirmar substituição', href: '#reserve-heading' }
    : pendingOperation && demand ? operationNextAction(pendingOperation, demandWindow(demand.job).start, demandWindow(demand.job).end, 'restaurant', now)
    : { label: candidates.length ? 'Analisar candidatos' : 'Convidar profissionais', href: `${base}?view=${candidates.length ? 'candidates' : 'talents'}` };
  const profile = personId ? personById.get(personId) : null;
  const renderCandidate = (application: DemandApplication, reserveOnly = false) => {
    const person = personById.get(application.worker_id);
    const isReserve = reserves.some((reserve) => reserve.worker_id === application.worker_id);
    return <article key={application.worker_id} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      {person ? <DemandPersonSummary person={person} role={demand?.job.title} profileHref={`${base}?view=profile&person=${person.id}`} /> : <p className="text-sm text-gray-500">Perfil não disponível. Os dados não foram compartilhados ou a conta foi excluída.</p>}
      <div className="flex flex-wrap items-center gap-2">
        {person && <Link href={`${base}?view=profile&person=${person.id}`} className="mr-auto inline-flex min-h-11 items-center text-xs font-semibold">Ver Perfil</Link>}
        {canHire && <Button variant="primary" disabled={busy !== null || !person} onClick={() => setConfirmHiring(application)} className="px-3 text-xs">{reserveOnly ? 'Confirmar Substituição' : 'Contratar'}</Button>}
        {reserveActive && (canReserve || isReserve) && <Button disabled={busy !== null || !person} onClick={() => void act(application, isReserve ? 'remove' : 'reserve')} className="px-3 text-xs">{isReserve ? 'Retirar da reserva' : 'Adicionar à reserva'}</Button>}
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
  const heading = view === 'talents' ? 'Rede de Talentos' : view === 'candidates' ? 'Candidatos' : view === 'profile' ? 'Perfil do profissional' : demand?.job.title ?? 'Detalhes da Operação';
  return (
    <main className="min-h-screen bg-[#fafaf9] px-5 py-6 pb-48 text-gray-950 sm:px-8">
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
        ) : view === 'talents' ? <DemandTalentNetwork demandId={demandId} /> : view === 'profile' ? (
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
              <p className="break-words text-xl font-semibold">{demand.job.title}</p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-gray-500">Data</p><p className="mt-1 font-medium">{demandDate(demand.job.job_date, now)}</p></div>
                <div><p className="text-xs text-gray-500">Horário</p><p className="mt-1 font-medium">{demand.job.start_time.slice(0, 5)} às {demand.job.end_time.slice(0, 5)}{demandWindow(demand.job).start.toDateString() !== demandWindow(demand.job).end.toDateString() ? ' (+1 dia)' : ''}</p></div>
                <div className="min-w-0"><p className="text-xs text-gray-500">Local</p><p className="mt-1 break-words font-medium">{demand.job.location_name || demand.job.work_address || 'Local a definir'}</p></div>
                <div><p className="text-xs text-gray-500">Por profissional</p><p className="mt-1 font-semibold">{Number(demand.job.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p></div>
              </div>
            </section>
            <section aria-labelledby="quick-heading" className="space-y-3">
              <h2 id="quick-heading" className="text-lg font-semibold">O que fazer agora</h2>
              <Link href={nextAction.href} className="ec-button ec-button--primary w-full px-3 text-sm">{nextAction.label}</Link>
              <nav aria-label="Etapas da operação" className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
                <Link href={`${base}?view=candidates`} className="inline-flex min-h-11 items-center">Candidatos</Link>
                <Link href="#hired-heading" className="inline-flex min-h-11 items-center">Equipe</Link>
                {(['chat', 'checkin', 'payment', 'checkout'] as const).map((section) => <Link key={section} href={`#${section}-heading`} className="inline-flex min-h-11 items-center">{section === 'chat' ? 'Chat' : section === 'checkin' ? 'Check-in' : section === 'payment' ? 'Pagamento' : 'Checkout'}</Link>)}
                {reserveActive && <Link href="#reserve-heading" className="inline-flex min-h-11 items-center">Substituição</Link>}
              </nav>
              <details>
                <summary className="cursor-pointer py-2 text-sm font-medium text-gray-600">Outras ações</summary>
                <div className="flex flex-wrap gap-3">
                  <Link href={`${base}?view=talents`} className="ec-button ec-button--secondary px-3 text-sm">Convidar Profissionais</Link>
                  <Button onClick={() => void share()} className="px-3 text-sm">Compartilhar Operação</Button>
                  {demand.canEdit && <Link href={`${base}?action=edit`} className="inline-flex min-h-11 items-center text-sm font-semibold text-gray-600">Editar</Link>}
                  <Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 text-xs text-gray-500">Atualizar operação</Button>
                </div>
              </details>
            </section>
            {actionError && <Toast tone="error">{actionError}</Toast>}
            {notice && <Toast tone="info">{notice}</Toast>}
            {peopleError && <Toast tone="info">{peopleError}</Toast>}
            {operationsError && <Toast tone="error">{operationsError}</Toast>}
            <section id="team-heading" aria-labelledby="candidates-heading" className="scroll-mt-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="candidates-heading" className="text-xl font-semibold">Candidatos recentes</h2><Link href={`${base}?view=candidates`} className="inline-flex min-h-11 items-center text-xs font-semibold text-orange-800">Ver todos ({candidates.length})</Link></div>
              {candidates.length ? candidates.slice(0, 3).map((candidate) => renderCandidate(candidate)) : <EmptyState title="Ainda não há candidatos." description="Divulgue sua operação para encontrar os profissionais certos."
                action={<Button variant="primary" onClick={() => void share()} className="px-4">Compartilhar Operação</Button>} />}
            </section>
            <section aria-labelledby="hired-heading" className="space-y-4">
              <h2 id="hired-heading" className="scroll-mt-6 text-xl font-semibold">Equipe contratada</h2>
              {hired.length ? hired.map((application) => {
                const person = personById.get(application.worker_id);
                const checkout = events.some((event) => event.kind === 'checkout' && event.worker_id === application.worker_id);
                const checkin = events.some((event) => event.kind === 'checkin' && event.worker_id === application.worker_id);
                const operation = operations.find((item) => item.job_id === application.job_id);
                const next = operation ? operationNextAction(operation, demandWindow(demand.job).start, demandWindow(demand.job).end, 'restaurant', now) : null;
                const status = application.status === 'completed' ? 'Concluído' : checkout ? 'Checkout Realizado' : application.status === 'in_progress' ? now >= demandWindow(demand.job).end ? 'Trabalho encerrado' : 'Trabalho em andamento' : checkin ? 'Check-in Realizado' : 'Confirmado';
                return <article key={application.worker_id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
                  {person ? <DemandPersonSummary person={person} role={demand.job.title} profileHref={`${base}?view=profile&person=${person.id}`} /> : <p className="text-sm text-gray-500">Profissional · perfil indisponível</p>}
                  <p className="text-xs font-medium text-emerald-800">{status}{checkin && status !== 'Check-in Realizado' ? ' · Check-in Realizado' : ''}{checkout && status !== 'Checkout Realizado' ? ' · Checkout Realizado' : ''}</p>
                  <div className="flex flex-wrap gap-4">
                    <Link href={`/chat/${application.job_id}`} className="inline-flex min-h-11 items-center text-xs font-semibold text-orange-800">Conversar</Link>
                    {next && !operation?.checkout_at && <Link href={next.href} className="inline-flex min-h-11 items-center text-xs font-semibold">{next.label}</Link>}
                    {application.status === 'completed' && <Link href={`/reviews/${application.job_id}`} className="inline-flex min-h-11 items-center text-xs font-semibold">Avaliar profissional</Link>}
                  </div>
                </article>;
              }) : <EmptyState title="Nenhum profissional contratado." description="Convide sua rede ou aprove uma candidatura."
                action={<Link href={`${base}?view=talents`} className="ec-button ec-button--primary px-4">Convidar Profissionais</Link>} />}
            </section>
            {reserveActive && <section aria-labelledby="reserve-heading" className="space-y-4">
              <h2 id="reserve-heading" className="scroll-mt-6 text-xl font-semibold">Substituição · candidatos e reserva</h2>
              <p className="text-sm text-gray-600">Uma posição foi reaberta. Confira a disponibilidade antes de confirmar a substituição. Alternativas ordenadas por confiabilidade compartilhada e histórico com sua empresa.</p>
              {alternatives.length ? alternatives.map((candidate, index) => <div key={candidate.worker_id} className="space-y-2">
                {index === 0 && <p className="text-xs font-semibold text-orange-800">Primeira alternativa para analisar · confirme a disponibilidade</p>}
                {renderCandidate(candidate, true)}
              </div>) : <Link href={`${base}?view=talents`} className="ec-button ec-button--primary px-4">Convidar pela Rede de Talentos</Link>}
              <p className="text-xs leading-5 text-gray-500">Reserva é uma indicação da empresa. Combine a disponibilidade com o profissional; ela não representa contratação.</p>
            </section>}
            {(['chat', 'checkin', 'payment', 'checkout'] as const).map((stage) => <section key={stage} aria-labelledby={`${stage}-heading`} className="space-y-3">
              <h2 id={`${stage}-heading`} className="scroll-mt-6 text-xl font-semibold">{stage === 'chat' ? 'Chat' : stage === 'checkin' ? 'Check-in' : stage === 'payment' ? 'Pagamento' : 'Checkout'}</h2>
              {hired.length ? hired.map((application) => {
                const operation = operations.find((item) => item.job_id === application.job_id);
                const value = stage === 'checkin' ? operation?.checkin_at : stage === 'payment' ? operation?.receipt_confirmed_at : operation?.checkout_at;
                return <div key={application.job_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                  <div><p className="text-sm font-semibold">{personById.get(application.worker_id)?.name ?? 'Profissional'}</p>
                    <p className="mt-1 text-xs text-gray-500">{stage === 'chat' ? 'Avisos, localização e ajustes finais. Não use para negociar contratação.' : operationsError || !operation ? 'Estado indisponível' : value ? `Confirmado em ${new Date(value).toLocaleString('pt-BR')}` : stage === 'payment' ? operation.paid_at ? 'Aguardando confirmação do profissional' : 'Aguardando encerramento e pagamento' : stage === 'checkout' ? 'Depende do recebimento confirmado pelo profissional' : 'Aguardando chegada'}</p></div>
                  <Link href={`/${stage}/${application.job_id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-800">{stage === 'chat' ? 'Conversar' : 'Abrir etapa'}</Link>
                </div>;
              }) : <p className="text-sm text-gray-500">Disponível após contratar um profissional.</p>}
            </section>)}
            <section aria-labelledby="timeline-heading" className="space-y-4">
              <h2 id="timeline-heading" className="text-xl font-semibold">Linha do tempo</h2>
              {historyError ? <Toast tone="error"><p>{historyError}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 underline">Tentar Novamente</Button></Toast> : events.length ? <ol className="space-y-0 rounded-2xl border border-gray-200 bg-white p-5">
                {events.slice(0, eventLimit).map((event) => <li key={event.id} className="relative border-l border-gray-200 pb-6 pl-5 last:pb-0">
                  <span aria-hidden="true" className="absolute -left-1 top-1 size-2 rounded-full bg-orange-700" />
                  <time dateTime={event.occurred_at} className="text-[11px] text-gray-500">{new Date(event.occurred_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
                  <p className="mt-1 text-sm font-medium">{eventLabels[event.kind] ?? 'Operação atualizada'}</p>
                  {event.worker_id && <p className="mt-0.5 text-xs text-gray-500">{personById.get(event.worker_id)?.name ?? 'Profissional'}</p>}
                </li>)}
              </ol> : <p className="text-sm text-gray-500">Nenhum evento registrado nesta operação.</p>}
              {events.length > eventLimit && <Button onClick={() => setEventLimit((value) => value + 20)} className="px-4 text-xs">Ver histórico completo</Button>}
            </section>
            <section aria-labelledby="location-heading" className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
              <h2 id="location-heading" className="text-xl font-semibold">Local</h2>
              <p className="font-medium">{demand.job.location_name || 'Local a definir'}</p>
              <p className="break-words text-sm leading-6 text-gray-500">{demandAddress(demand) || 'Endereço ainda não informado.'}</p>
              {maps?.map && (mapAllowed ? <iframe title="Mapa do local da operação" src={maps.map} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts" className="h-44 w-full rounded-xl border-0" /> : <div className="rounded-xl bg-gray-50 p-4"><p className="text-xs leading-5 text-gray-500">Carregar o mapa conecta seu navegador ao OpenStreetMap.</p><Button onClick={() => setMapAllowed(true)} className="mt-2 px-3 text-xs">Carregar mapa</Button></div>)}
              {maps?.route && <a href={maps.route} target="_blank" rel="noopener noreferrer" className="ec-button ec-button--secondary px-4 text-sm">Abrir rota ↗</a>}
            </section>
            <section aria-labelledby="notes-heading" className="rounded-2xl border border-gray-200 bg-white p-5">
              <h2 id="notes-heading" className="text-xl font-semibold">Detalhes</h2>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-gray-600">{demand.job.description || 'Nenhuma orientação adicional.'}</p>
            </section>
          </>
        )}
      </section>
      {demand && !loading && !error && !view && !action && demand.active && <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex justify-center bg-gradient-to-t from-white via-white/95 to-white/0 px-5 pt-5 pb-3">
        <Link href={nextAction.href} className="ec-button ec-button--primary pointer-events-auto min-h-12 w-full max-w-xl px-4 text-sm">{nextAction.label}</Link>
      </div>}
      {confirmHiring && <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} aria-labelledby="confirm-hiring-heading" onCancel={(event) => { if (busy) event.preventDefault(); else setConfirmHiring(null); }} className="m-auto w-[calc(100%-2rem)] max-w-lg space-y-5 rounded-2xl border border-gray-200 bg-white p-6 text-gray-950 backdrop:bg-black/40">
        <h2 id="confirm-hiring-heading" className="text-xl font-semibold">Confirmar Contratação</h2>
        {personById.get(confirmHiring.worker_id) && <DemandPersonSummary person={personById.get(confirmHiring.worker_id)!} role={demand?.job.title} />}
        <p className="text-sm text-gray-600">Ao confirmar, o profissional entra na equipe e o chat fica disponível.</p>
        {actionError && <Toast tone="error">{actionError}</Toast>}
        <div className="flex flex-wrap gap-3">
          <Button autoFocus disabled={busy !== null} onClick={() => setConfirmHiring(null)} className="px-4">Cancelar</Button>
          <Button variant="primary" busy={busy !== null} onClick={() => void act(confirmHiring, 'hire')} className="px-4">Confirmar Contratação</Button>
        </div>
      </dialog>}
      <MobileBottomNav role="restaurant" showOnDesktop />
    </main>
  );
}
