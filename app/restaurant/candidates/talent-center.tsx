'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, LoadingSkeleton, Select, TextInput, Toast } from '@/app/components/ui';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { createClient } from '@/lib/supabase/client';
import ProfessionalVerification from '@/app/components/professional-verification';
import { buildDemands, canHireDemand, canRecruitDemand, demandWindow, loadDemands, type Demand } from '@/lib/demands';
import { signDemandPhotos } from '@/lib/demand-detail';
import type { OperationalReputation } from '@/lib/operations';
import { commonSpecialties } from '@/lib/specialties';
import {
  classifyDemandTalents,
  demandStatusLabels,
  matchesDemandFunction,
  rankSuggestions,
  relativeTime,
  stableSuggestions,
  type DemandInvitationState,
  type DemandTalentStatus,
} from '@/lib/talent-board';

interface TalentReview {
  restaurant_name: string;
  rating: number;
  created_at: string;
  comment: string;
}

interface TalentOperation {
  title: string;
  job_date: string;
  hired_at: string | null;
  status: string;
}

interface Talent {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  bio: string | null;
  specialties: string[] | null;
  score: number | null;
  photo_path: string | null;
  photoUrl?: string | null;
  experience: string | null;
  categories: string[];
  completed_operations: number;
  invitation_status: string | null;
  reputation: OperationalReputation | null;
  review_count: number | null;
  reviews: TalentReview[];
  restaurant_operations: number;
  last_hired_at: string | null;
  history: TalentOperation[];
}

interface InvitationRow extends DemandInvitationState {
  demand_id: string;
}

type TalentTab = 'all' | 'candidates' | 'invited' | 'interests';

const tabs: Array<{ id: TalentTab; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'candidates', label: 'Candidatos' },
  { id: 'invited', label: 'Convidados' },
  { id: 'interests', label: 'Interesses' },
];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
}

function percentage(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
}

function cityName(talent: Talent) {
  return [talent.city, talent.state].filter(Boolean).join('/');
}

function rating(talent: Talent) {
  return talent.reputation?.average_rating ?? talent.score;
}

function PersonPhoto({ talent, large = false, onClick }: { talent: Talent; large?: boolean; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  const size = large ? 'size-24' : 'size-14';
  return (
    <Button variant="ghost" type="button" onClick={onClick} aria-label={`Ver perfil de ${talent.name}`}
      className={`relative grid ${size} shrink-0 place-items-center overflow-hidden rounded-2xl bg-orange-50 px-0 font-semibold text-orange-900`}>
      {talent.photoUrl && !failed
        ? <Image src={talent.photoUrl} alt="" fill unoptimized sizes={large ? '96px' : '56px'} className="object-cover" onError={() => setFailed(true)} />
        : <span aria-hidden="true" className={large ? 'text-3xl' : 'text-lg'}>{talent.name.charAt(0).toUpperCase()}</span>}
    </Button>
  );
}

function SectionHeading({ id, children, count }: { id: string; children: React.ReactNode; count: number }) {
  return <h2 id={id} className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{children} <span className="text-gray-400">({count})</span></h2>;
}

export default function TalentCenter({ initialDemandId = null }: { initialDemandId?: string | null }) {
  const [supabase] = useState(() => createClient());
  const [talents, setTalents] = useState<Talent[]>([]);
  const [demands, setDemands] = useState<Demand[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [demandId, setDemandId] = useState(initialDemandId ?? '');
  const [tab, setTab] = useState<TalentTab>('all');
  const [search, setSearch] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [city, setCity] = useState('');
  const [workedWithMe, setWorkedWithMe] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyInterests, setOnlyInterests] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [suggestionMemo, setSuggestionMemo] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<Talent | null>(null);
  const [allReviews, setAllReviews] = useState<{ workerId: string; rows: TalentReview[] } | null>(null);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [approveTarget, setApproveTarget] = useState<Talent | null>(null);
  const [hiredContext, setHiredContext] = useState<{ demandId: string; title: string; workerId: string; name: string; jobId: string | null } | null>(null);
  const [allHistory, setAllHistory] = useState<{ workerId: string; rows: TalentOperation[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failedAction, setFailedAction] = useState<{ kind: 'directory' | 'invite' | 'hire' | 'connection'; talent?: Talent; demandId?: string; error?: string } | null>(null);
  const error = failedAction?.error ?? '';
  const setError = (message: string) => setFailedAction((action) => action
    ? { ...action, error: message }
    : message ? { kind: 'directory', error: message } : null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [retry, setRetry] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 1000);
    const reload = () => { refresh(); if (!loading && !busy) setRetry((value) => value + 1); };
    const reloadTimer = window.setInterval(reload, 30_000);
    window.addEventListener('focus', reload);
    return () => { window.clearInterval(timer); window.clearInterval(reloadTimer); window.removeEventListener('focus', reload); };
  }, [loading, busy]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const now = new Date();
        const demandData = await loadDemands(supabase);
        const loadedDemands = buildDemands(demandData.jobs, demandData.applications, demandData.reserves, now)
          .filter((demand) => canHireDemand(demand, now))
          .sort((a, b) => demandWindow(a.job).start.getTime() - demandWindow(b.job).start.getTime());
        const rows: Talent[] = [];
        for (let offset = 0; ; offset += 100) {
          const { data, error: directoryError } = await supabase.rpc('restaurant_talent_directory', {
            p_offset: offset,
            p_limit: 100,
          });
          if (directoryError) throw new Error(directoryError.message);
          if (!Array.isArray(data)) throw new Error('O serviço não retornou os profissionais.');
          rows.push(...data as Talent[]);
          if (data.length < 100) break;
        }
        const invitationRows: InvitationRow[] = [];
        const demandIds = loadedDemands.map((demand) => demand.id);
        for (let offset = 0; offset < demandIds.length; offset += 100) {
          const { data, error: invitationError } = await supabase.from('demand_invitations')
            .select('demand_id, worker_id, status')
            .in('demand_id', demandIds.slice(offset, offset + 100));
          if (invitationError) throw new Error(invitationError.message);
          if (!data) throw new Error('O serviço não retornou os convites das operações.');
          invitationRows.push(...data as InvitationRow[]);
        }
        const signed = await signDemandPhotos(supabase, rows);
        if (mounted) {
          setFailedAction((action) => action?.kind === 'directory' ? null : action);
          setTalents(signed as Talent[]);
          setSelected((person) => person ? (signed as Talent[]).find((row) => row.id === person.id) ?? person : null);
          setDemands(loadedDemands);
          setInvitations(invitationRows);
          setHiredContext((context) => {
            if (!context) return null;
            const application = demandData.applications.find((row) => row.worker_id === context.workerId
              && ['approved', 'in_progress', 'completed'].includes(row.status)
              && demandData.jobs.some((job) => job.id === row.job_id && (job.demand_id || job.id) === context.demandId));
            return application && application.job_id !== context.jobId ? { ...context, jobId: application.job_id } : context;
          });
          setDemandId((current) => loadedDemands.some((demand) => demand.id === current)
            ? current
            : (loadedDemands.find((demand) => demand.hired < demand.required) ?? loadedDemands[0])?.id ?? '');
        }
      } catch (loadError) {
        if (mounted) {
          setFailedAction({ kind: 'directory', error: loadError instanceof Error ? loadError.message : 'Não foi possível carregar os profissionais.' });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, [retry, supabase]);

  useEffect(() => {
    if (hiredContext && !approveTarget && !filtersOpen) document.getElementById('talent-hire-result')?.focus();
  }, [hiredContext, approveTarget, filtersOpen, selected?.id]);

  const availableDemands = demands.filter((demand) => canHireDemand(demand, now));
  const current = availableDemands.find((demand) => demand.id === demandId) ?? null;
  const recruiting = Boolean(current && canRecruitDemand(current, now));
  const full = Boolean(current && current.hired >= current.required);
  const talentById = useMemo(() => new Map(talents.map((talent) => [talent.id, talent])), [talents]);
  const board = classifyDemandTalents(
    current?.applications ?? [],
    invitations.filter((invitation) => invitation.demand_id === current?.id),
  );

  const statusOf = (talent: Talent): DemandTalentStatus | null => board.invited.get(talent.id) ?? board.candidates.get(talent.id) ?? null;

  const matches = (talent: Talent) => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const text = [talent.name, talent.specialties?.join(' '), talent.bio, talent.experience, cityName(talent)]
      .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
    return (!term || text.includes(term))
      && (!specialty || talent.specialties?.some((value) => value.toLocaleLowerCase('pt-BR') === specialty.toLocaleLowerCase('pt-BR')))
      && (!city || cityName(talent) === city)
      && (!workedWithMe || talent.completed_operations > 0)
      && (!onlyFavorites || talent.categories.includes('favorite'))
      && (!onlyInterests || talent.categories.includes('interest'));
  };

  const invitedPeople = [...board.invited.keys()].map((id) => talentById.get(id)).filter((talent): talent is Talent => Boolean(talent));
  const candidatePeople = [...board.candidates.keys()].map((id) => talentById.get(id)).filter((talent): talent is Talent => Boolean(talent));
  const interestPeople = talents.filter((talent) => talent.categories.includes('interest'));
  const visibleInvited = invitedPeople.filter(matches);
  const visibleCandidates = candidatePeople.filter(matches);
  const visibleInterests = interestPeople.filter(matches);

  const rankedEligible = current && recruiting && !full
    ? rankSuggestions(talents.filter((talent) => !board.applicationByWorker.has(talent.id) && !board.invited.has(talent.id)), current.job.title).map((talent) => talent.id)
    : [];
  const previousSuggestions = suggestionMemo[demandId] ?? [];
  const suggestionIds = stableSuggestions(previousSuggestions, rankedEligible);
  if (current && suggestionIds.join() !== previousSuggestions.join()) {
    setSuggestionMemo((memo) => ({ ...memo, [current.id]: suggestionIds }));
  }
  const suggestions = suggestionIds.map((id) => talentById.get(id)).filter((talent): talent is Talent => Boolean(talent));
  const visibleSuggestions = suggestions.filter(matches);

  const cities = [...new Set(talents.map(cityName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const specialties = [...new Set(talents.flatMap((talent) => talent.specialties ?? []))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const activeFilters = [
    specialty && { key: 'specialty', label: specialty, clear: () => setSpecialty('') },
    city && { key: 'city', label: city, clear: () => setCity('') },
    workedWithMe && { key: 'worked', label: 'Já trabalhou comigo', clear: () => setWorkedWithMe(false) },
    onlyFavorites && { key: 'favorites', label: 'Apenas Favoritos', clear: () => setOnlyFavorites(false) },
    onlyInterests && { key: 'interests', label: 'Apenas Interesses', clear: () => setOnlyInterests(false) },
  ].filter((item): item is { key: string; label: string; clear: () => void } => Boolean(item));
  const clearFilters = () => {
    setSearch('');
    setSpecialty('');
    setCity('');
    setWorkedWithMe(false);
    setOnlyFavorites(false);
    setOnlyInterests(false);
  };
  const tabCounts: Record<TalentTab, number> = {
    all: current ? visibleInvited.length + visibleCandidates.length + visibleSuggestions.length : 0,
    candidates: current ? visibleCandidates.length : 0,
    invited: current ? visibleInvited.length : 0,
    interests: visibleInterests.length,
  };

  const setConnection = async (talent: Talent, category: 'favorite' | 'interest', enabled: boolean) => {
    setBusy(talent.id);
    setError('');
    setNotice('');
    try {
      const { error: actionError } = await supabase.rpc('set_talent_connection', {
        p_worker_id: talent.id,
        p_category: category,
        p_enabled: enabled,
      });
      if (actionError) throw new Error(actionError.message);
      const opposite = category === 'favorite' ? 'interest' : 'favorite';
      const update = (person: Talent) => person.id === talent.id
        ? {
          ...person,
          categories: enabled
            ? [...person.categories.filter((value) => value !== opposite && value !== category), category]
            : person.categories.filter((value) => value !== category),
        }
        : person;
      setTalents((list) => list.map(update));
      setSelected((person) => person ? update(person) : null);
      setNotice(category === 'favorite'
        ? enabled ? `${talent.name} foi marcado como favorito.` : `${talent.name} foi removido dos favoritos.`
        : enabled ? `Você está acompanhando ${talent.name}.` : `${talent.name} foi removido dos interesses.`);
    } catch (actionError) {
      setFailedAction({ kind: 'connection', talent });
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível atualizar o relacionamento.');
    } finally {
      setBusy('');
    }
  };

  const relationshipAction = (talent: Talent) => {
    const worked = talent.completed_operations > 0;
    const isFavorite = talent.categories.includes('favorite');
    const isInterest = talent.categories.includes('interest');
    if (worked || isFavorite) {
      return {
        label: isFavorite ? '♥ Favorito' : '♡ Favoritar',
        aria: isFavorite ? `Remover ${talent.name} dos favoritos` : `Marcar ${talent.name} como favorito`,
        run: () => void setConnection(talent, 'favorite', !isFavorite),
      };
    }
    return {
      label: isInterest ? '👀 Interesse ✓' : '👀 Interesse',
      aria: isInterest ? `Deixar de acompanhar ${talent.name}` : `Marcar interesse em ${talent.name}`,
      run: () => void setConnection(talent, 'interest', !isInterest),
    };
  };

  const toggleReviews = async () => {
    if (selected && reviewExpanded && allReviews?.workerId === selected.id) {
      setReviewExpanded(false);
      return;
    }
    if (!selected) return;
    if (allReviews?.workerId === selected.id) {
      setReviewExpanded(true);
      return;
    }
    setReviewLoading(true);
    setReviewError('');
    try {
      const rows: TalentReview[] = [];
      let total = 0;
      for (let offset = 0; ; offset += 100) {
        const { data, error: queryError } = await supabase.rpc('restaurant_talent_reviews', {
          p_worker_id: selected.id,
          p_offset: offset,
          p_limit: 100,
        });
        if (queryError) throw new Error(queryError.message);
        if (!Array.isArray(data)) throw new Error('O serviço não retornou as avaliações.');
        const page = data as Array<TalentReview & { total_count: number }>;
        rows.push(...page.map(({ restaurant_name, rating: value, created_at, comment }) => ({ restaurant_name, rating: value, created_at, comment })));
        total = Number(page[0]?.total_count ?? total);
        if (rows.length >= total || page.length < 100) break;
      }
      setAllReviews({ workerId: selected.id, rows });
      setReviewExpanded(true);
    } catch (reviewLoadError) {
      setReviewError(reviewLoadError instanceof Error ? reviewLoadError.message : 'Não foi possível carregar todas as avaliações.');
    } finally {
      setReviewLoading(false);
    }
  };

  const toggleHistory = async () => {
    if (!selected) return;
    if (historyOpen && allHistory?.workerId === selected.id) {
      setHistoryOpen(false);
      return;
    }
    if (allHistory?.workerId === selected.id) {
      setHistoryOpen(true);
      return;
    }
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const rows: TalentOperation[] = [];
      let total = 0;
      for (let offset = 0; ; offset += 100) {
        const { data, error: queryError } = await supabase.rpc('restaurant_talent_history', {
          p_worker_id: selected.id,
          p_offset: offset,
          p_limit: 100,
        });
        if (queryError) throw new Error(queryError.message);
        if (!Array.isArray(data)) throw new Error('O serviço não retornou o histórico de operações.');
        const page = data as Array<TalentOperation & { total_count: number }>;
        rows.push(...page.map(({ title, job_date, hired_at, status }) => ({ title, job_date, hired_at, status })));
        total = Number(page[0]?.total_count ?? total);
        if (rows.length >= total || page.length < 100) break;
      }
      setAllHistory({ workerId: selected.id, rows });
      setHistoryOpen(true);
    } catch (historyLoadError) {
      setHistoryError(historyLoadError instanceof Error ? historyLoadError.message : 'Não foi possível carregar o histórico.');
    } finally {
      setHistoryLoading(false);
    }
  };

  const invite = async (talent: Talent) => {
    setFailedAction({ kind: 'invite', talent });
    if (!current || !canRecruitDemand(current, new Date())) {
      setError('O recrutamento desta operação foi encerrado.');
      return;
    }
    setBusy(talent.id);
    setError('');
    setNotice('');
    try {
      const { error: actionError } = await supabase.rpc('invite_demand_worker', {
        p_demand_id: current.id,
        p_worker_id: talent.id,
      });
      if (actionError) throw new Error(actionError.message);
      setInvitations((rows) => [...rows, { demand_id: current.id, worker_id: talent.id, status: 'pending' }]);
      setNotice(`Convite enviado para ${talent.name}. A candidatura só será criada se o profissional aceitar.`);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível enviar o convite.');
    } finally {
      setBusy('');
    }
  };

  const approve = async () => {
    if (!approveTarget) return;
    setFailedAction({ kind: 'hire', talent: approveTarget, demandId: current?.id ?? demandId });
    if (!current || !canHireDemand(current, new Date())) {
      setError('O horário de contratação desta operação foi encerrado.');
      return;
    }
    setBusy(approveTarget.id);
    setError('');
    setNotice('');
    try {
      const { error: actionError } = await supabase.rpc('approve_demand_candidate', {
        p_demand_id: current.id,
        p_worker_id: approveTarget.id,
      });
      if (actionError) throw new Error(actionError.message);
      setHiredContext({ demandId: current.id, title: current.job.title, workerId: approveTarget.id, name: approveTarget.name, jobId: null });
      setNotice('');
      setApproveTarget(null);
      setRetry((value) => value + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Não foi possível aprovar a candidatura.');
    } finally {
      setBusy('');
    }
  };

  const openProfile = (talent: Talent) => {
    setSelected(talent);
    setHistoryOpen(false);
    setReviewExpanded(false);
    setReviewError('');
    setHistoryError('');
    setError('');
  };

  const renderCard = (talent: Talent, status: DemandTalentStatus | null) => {
    const score = rating(talent);
    const isFavorite = talent.categories.includes('favorite');
    const isInterest = talent.categories.includes('interest');
    const lastHire = relativeTime(talent.last_hired_at);
    const relationship = relationshipAction(talent);
    const canApprove = Boolean(current && canHireDemand(current, now)) && !full && (status === 'candidate' || status === 'accepted');
    const recommended = status === null && suggestionIds.includes(talent.id);
    const statusText = status === 'candidate'
      ? full ? 'Equipe já definida' : 'Aguardando aprovação · Pode ser contratado'
      : status ? demandStatusLabels[status] : recommended ? 'Recomendado para esta operação' : 'Perfil para avaliação';
    return <article key={talent.id} className="ec-card flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <div><Badge tone={status === 'approved' ? 'success' : status === 'candidate' || status === 'accepted' ? 'warning' : status === 'unavailable' ? 'neutral' : 'info'}>{statusText}</Badge></div>
      <div className="flex min-w-0 items-start gap-3">
        <PersonPhoto talent={talent} onClick={() => openProfile(talent)} />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center font-semibold text-gray-950"><span className="min-w-0 break-words">{talent.name}</span><ProfessionalVerification userId={talent.id} /></h3>
          <span className="mt-1 inline-flex max-w-full break-words rounded-md bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-800">{talent.specialties?.[0] || 'Profissional'}</span>
          <p className="mt-1.5 break-words text-xs text-gray-500">{cityName(talent) || 'Cidade não compartilhada'}</p>
        </div>
      </div>
      <div className="space-y-2 text-xs text-gray-700">
        {talent.completed_operations > 0
          ? <Badge tone="success">Trabalhou com você {talent.completed_operations} {talent.completed_operations === 1 ? 'vez' : 'vezes'}</Badge>
          : <p>Sem operações concluídas com você.</p>}
        {talent.completed_operations > 0 && lastHire && <p>Última contratação: {lastHire}</p>}
        {isFavorite && <Badge>Favorito</Badge>}
        {isInterest && <Badge>Interesse marcado por você</Badge>}
      </div>
      {recommended && <div className="flex flex-wrap gap-2 text-xs">
        {current && matchesDemandFunction(talent.specialties, current.job.title) && <Badge tone="info">Compatível com a função</Badge>}
        {isFavorite && <span>Marcado como favorito por você.</span>}
        {score != null && <span>Avaliação compartilhada: {Number(score).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 5.</span>}
        {talent.completed_operations === 0 && !isFavorite && !(current && matchesDemandFunction(talent.specialties, current.job.title))
          && score == null && <span>Sem histórico com você ou avaliação compartilhada; confira o perfil antes de convidar.</span>}
      </div>}
      <div className="rounded-xl bg-gray-50 p-3">
        <div><p className="text-sm font-semibold text-gray-900"><span aria-hidden="true" className="text-amber-500">★</span> {score === null || score === undefined ? '—' : `${Number(score).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 5`}</p><p className="mt-1 text-xs text-gray-500">{score === null || score === undefined ? 'Sem avaliação compartilhada' : 'Avaliação média'}</p></div>
        <p className="mt-1 text-xs text-gray-600">{talent.review_count === null ? 'Avaliações privadas' : `${talent.review_count} avaliações compartilhadas`}</p>
      </div>
      <p className="line-clamp-2 break-words text-sm leading-6 text-gray-600">{talent.experience?.trim() || 'Experiência não compartilhada.'}</p>
      <p className="text-xs text-gray-600">{talent.reputation ? `${talent.reputation.completed} operações concluídas` : 'Operações: sem dados compartilhados'}</p>
      {!talent.reputation && score == null && <Badge tone="warning">Dados insuficientes</Badge>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" onClick={() => openProfile(talent)} className="px-2 text-xs">Ver perfil</Button>
          <Button variant="ghost" aria-label={relationship.aria} disabled={busy !== ''} onClick={relationship.run} className="px-2 text-xs">{relationship.label}</Button>
        </div>
        {status === 'accepted' && canApprove && <Button variant="secondary" onClick={() => openProfile(talent)} className="px-4 text-xs">Avaliar candidatura</Button>}
        {canApprove && <Button variant="primary" onClick={() => { setError(''); setApproveTarget(talent); }} className="px-4 text-xs">Confirmar contratação</Button>}
        {status === 'awaiting' && <p className="text-xs text-gray-600">Aguardando resposta</p>}
        {status === 'approved' && current && <Link href={`/restaurant/demands/${current.id}`} className="ec-button px-3 text-xs">Abrir operação</Link>}
        {!status && recruiting && !full && !board.applicationByWorker.has(talent.id)
          && <Button variant="primary" busy={busy === talent.id} disabled={busy !== ''} onClick={() => void invite(talent)} className="px-3 text-xs">Convidar para operação</Button>}
      </div>
    </article>;
  };

  const cardGrid = (people: Talent[]) => <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{people.map((talent) => renderCard(talent, statusOf(talent)))}</div>;
  const filteredOut = <EmptyState title="Nenhum profissional encontrado para os critérios atuais." description="Revise a busca, função, cidade ou relacionamento." action={<Button onClick={clearFilters}>Limpar filtros</Button>} />;

  const invitedSection = <section aria-labelledby="invited-heading" className="space-y-3">
    <SectionHeading id="invited-heading" count={visibleInvited.length}>Convidados</SectionHeading>
    {visibleInvited.length ? cardGrid(visibleInvited)
      : invitedPeople.length ? filteredOut
        : <EmptyState title="Nenhum convite enviado." description="Explore a rede e envie um convite para esta operação." action={<Link className="ec-button px-3" href={`/restaurant/demands/${current?.id}?view=talents`}>Convidar profissionais</Link>} />}
  </section>;

  const candidateSection = <section aria-labelledby="candidates-heading" className="space-y-3">
    <SectionHeading id="candidates-heading" count={visibleCandidates.length}>Candidatos</SectionHeading>
    {visibleCandidates.length ? cardGrid(visibleCandidates)
      : candidatePeople.length ? filteredOut
        : <EmptyState title="Ainda não existem candidatos para esta operação." description="Convide profissionais da rede enquanto aguarda candidaturas." action={<Link className="ec-button px-3" href={`/restaurant/demands/${current?.id}?view=talents`}>Explorar talentos</Link>} />}
  </section>;

  const recommendationSection = <section aria-labelledby="recommendations-heading" className="space-y-3">
    <SectionHeading id="recommendations-heading" count={visibleSuggestions.length}>Recomendações</SectionHeading>
    {visibleSuggestions.length ? cardGrid(visibleSuggestions) : suggestions.length ? filteredOut
      : <EmptyState title="Nenhuma recomendação disponível neste momento." description="A rede completa continua acessível no contexto desta operação." action={<Link className="ec-button px-3" href={`/restaurant/demands/${current?.id}?view=talents`}>Explorar rede completa</Link>} />}
  </section>;
  const noDemand = <EmptyState title="Selecione uma operação para visualizar talentos." description="A central mostra operações elegíveis para recrutamento. Operações já contratadas continuam em Operações e Equipe."
    action={<Link href="/restaurant/demands" className="ec-button ec-button--primary px-4">Escolher operação</Link>} />;
  const hireResult = hiredContext && <section id="talent-hire-result" tabIndex={-1} aria-labelledby="talent-hire-heading" className="ec-card space-y-3 border-emerald-200 bg-emerald-50 p-4">
    <h2 id="talent-hire-heading" className="font-semibold">Contratação concluída</h2>
    <p role="status" className="break-words text-sm">{hiredContext.name} · {hiredContext.title}</p>
    <div className="flex flex-wrap gap-2">
      <Link href="/restaurant/team" className="ec-button px-3 text-sm">Ir para Equipe</Link>
      <Link href={`/restaurant/demands/${hiredContext.demandId}`} className="ec-button px-3 text-sm">Abrir operação</Link>
      {hiredContext.jobId ? <Link href={`/chat/${hiredContext.jobId}`} className="ec-button px-3 text-sm">Abrir chat</Link>
        : <Button onClick={() => setRetry((value) => value + 1)}>Atualizar acesso ao chat</Button>}
    </div>
  </section>;

  const selectedStatus = selected ? statusOf(selected) : null;
  const errorFeedback = error && <Toast tone="error" title={failedAction?.kind === 'directory' ? 'Não foi possível carregar os talentos.'
    : failedAction?.kind === 'invite' ? 'Não foi possível enviar o convite.'
      : failedAction?.kind === 'hire' ? 'Não foi possível concluir a contratação.' : 'Não foi possível atualizar o relacionamento.'}>
    <p>{error}</p>
    <Button variant="ghost" onClick={() => {
      if (failedAction?.kind === 'hire' && approveTarget) void approve();
      else if (failedAction?.kind === 'hire' && failedAction.talent && failedAction.demandId) {
        setDemandId(failedAction.demandId);
        setApproveTarget(failedAction.talent);
        setError('');
      }
      else if (failedAction?.kind === 'invite' && failedAction.talent) void invite(failedAction.talent);
      else { setError(''); setRetry((value) => value + 1); }
    }} disabled={busy !== ''} className="px-0 underline">Tentar novamente</Button>
  </Toast>;
  const location = selected ? cityName(selected) : '';
  const average = selected ? rating(selected) : null;
  const punctuality = selected?.reputation?.punctuality ?? null;
  const attendance = selected?.reputation && selected.reputation.checkins + selected.reputation.absences > 0
    ? selected.reputation.checkins / (selected.reputation.checkins + selected.reputation.absences) * 100 : null;
  const selectedRelationship = selected ? relationshipAction(selected) : null;

  return (
    <main className="ec-talents min-h-screen bg-[#fafaf9] px-4 py-5 pb-28 text-gray-950 sm:px-8 sm:py-7">
      <section className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Talentos</h1>
            <p className="mt-1 text-sm leading-6 text-gray-600">Encontre, convide e contrate profissionais para suas operações.</p>
          </div>
        </header>

        {demands.length > 0 && <section aria-label="Operação selecionada" className="ec-card min-w-0 space-y-3 border-orange-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-widest text-orange-800">Operação selecionada</p><h2 className="mt-1 break-words text-xl font-semibold">{current?.job.title}</h2></div>
            <label className="block min-w-0 w-full text-xs font-semibold text-gray-500 sm:w-auto">
            <span className="sr-only">Operação</span>
            <Select id="talent-operation" value={demandId} onChange={(event) => {
              setDemandId(event.target.value);
              const url = new URL(window.location.href);
              url.searchParams.set('demand', event.target.value);
              window.history.replaceState(null, '', url);
            }} className="min-h-11 w-full truncate py-2 text-sm text-gray-900 sm:max-w-64">
              {availableDemands.map((demand) => <option key={demand.id} value={demand.id}>{demand.job.title} · {formatDate(demand.job.job_date)}{canRecruitDemand(demand, now) ? '' : ' · Recrutamento encerrado'}</option>)}
            </Select>
            </label>
          </div>
          {current && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-orange-100 pt-3 text-sm text-gray-600">
            <span>{formatDate(current.job.job_date)} · {current.job.start_time.slice(0, 5)} às {current.job.end_time.slice(0, 5)}</span>
            <span className="font-semibold text-gray-900">{Number(current.job.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} / diária</span>
            <Link href={`/restaurant/demands/${current.id}`} className="inline-flex min-h-11 items-center font-semibold text-orange-800 sm:ml-auto">Ver operação →</Link>
          </div>}
        </section>}

        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 text-gray-400">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Buscar profissional</span>
          <TextInput type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar profissional..."
            className="min-h-10 border-0 bg-transparent px-0 text-sm shadow-none focus:border-0 focus:outline-none" />
        </label>

        {activeFilters.length > 0 && <div aria-label="Filtros ativos" className="flex flex-wrap gap-2">
          {activeFilters.map((filter) => <Button key={filter.key} variant="ghost" onClick={filter.clear} aria-label={`Remover filtro ${filter.label}`}
            className="min-h-8 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-900">
            {filter.label} <span aria-hidden="true">✕</span>
          </Button>)}
        </div>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Talentos da operação" className="flex min-w-0 flex-wrap gap-2">
            {tabs.map((item, index) => <Button key={item.id} id={`talent-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id}
              aria-controls="talent-results" tabIndex={tab === item.id ? 0 : -1} variant="ghost"
              onKeyDown={(event) => {
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                  : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
                if (next === null) return;
                event.preventDefault();
                setTab(tabs[next].id);
                document.getElementById(`talent-tab-${tabs[next].id}`)?.focus();
              }}
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-full border px-3 py-2 text-sm font-semibold ${tab === item.id ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-gray-200 bg-white text-gray-600 hover:text-gray-900'}`}>
                {item.label} <span className={`ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold ${tab === item.id ? 'bg-orange-100 text-orange-900' : 'bg-gray-100 text-gray-600'}`}>{loading && !talents.length ? '—' : tabCounts[item.id]}</span>
            </Button>)}
          </div>
          <Button variant="ghost" aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}
            className="shrink-0 px-2 text-sm font-semibold text-gray-700">
            <span aria-hidden="true">⚙</span> Filtros{activeFilters.length ? ` (${activeFilters.length})` : ''}
          </Button>
        </div>

        {!selected && !approveTarget && !filtersOpen && errorFeedback}
        {!selected && notice && <Toast tone="info" onDismiss={() => setNotice('')}>{notice}</Toast>}
        {!selected && hireResult}

        <div id="talent-results" role="tabpanel" aria-labelledby={`talent-tab-${tab}`} tabIndex={0} aria-busy={loading}>
        {loading && !talents.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <LoadingSkeleton key={item} label="Carregando talentos..." />)}</div>
          : error && !talents.length ? null
            : tab === 'interests'
              ? visibleInterests.length ? cardGrid(visibleInterests)
                : interestPeople.length ? filteredOut
                  : <EmptyState icon="👀" title="Nenhum profissional marcado como interesse." description="Marque 👀 Interesse nos profissionais que você quer acompanhar." />
              : !current ? noDemand
                : <div className="space-y-4">
                  {full && <div role="status" className="ec-card border-blue-200 bg-blue-50 p-4">
                    <p className="font-semibold text-blue-900">Equipe completa</p>
                    <p className="mt-1 text-sm text-blue-900">Todas as vagas desta operação já foram preenchidas.</p>
                  </div>}
                  {tab !== 'candidates' && invitedSection}
                  {tab !== 'invited' && candidateSection}
                  {tab === 'all' && recommendationSection}
                </div>}
        </div>
      </section>

      {filtersOpen && <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} aria-modal="true" aria-labelledby="talent-filters-heading"
        onCancel={() => setFiltersOpen(false)} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-gray-950"
        onClick={(event) => { if (event.target === event.currentTarget) setFiltersOpen(false); }}>
        <div
          className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-96 md:rounded-none">
          <div className="flex min-h-14 items-center justify-between border-b border-gray-200 px-5">
            <h2 id="talent-filters-heading" className="text-sm font-semibold">Filtros</h2>
            <Button autoFocus variant="ghost" aria-label="Fechar filtros" onClick={() => setFiltersOpen(false)} className="px-3 text-xl">×</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {errorFeedback}
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="talent-specialty">Função</label>
              <Select id="talent-specialty" value={specialty} onChange={(event) => setSpecialty(event.target.value)}>
                <option value="">Todas as funções</option>
                {(specialties.length ? specialties : commonSpecialties).map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="talent-city">Cidade</label>
              <Select id="talent-city" value={city} onChange={(event) => setCity(event.target.value)}>
                <option value="">Qualquer cidade</option>{cities.map((item) => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>
            {([
              ['Já trabalhou comigo', workedWithMe, setWorkedWithMe],
              ['Apenas Favoritos', onlyFavorites, setOnlyFavorites],
              ['Apenas Interesses', onlyInterests, setOnlyInterests],
            ] as const).map(([label, checked, update]) => <label key={label} className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-gray-800">
              {label}
              <TextInput type="checkbox" checked={checked} onChange={(event) => update(event.target.checked)} className="size-5 accent-orange-700" />
            </label>)}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-gray-200 p-4">
            <Button onClick={clearFilters} className="min-w-0 flex-1 basis-32 px-3">Limpar filtros</Button>
            <Button variant="primary" onClick={() => setFiltersOpen(false)} className="min-w-0 flex-1 basis-32 px-3">Ver profissionais</Button>
          </div>
        </div>
      </dialog>}

      {selected && <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} aria-modal="true" aria-labelledby="talent-profile-heading"
        onCancel={() => setSelected(null)} className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-gray-950"
        onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <div className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl">
          <div className="flex min-h-14 items-center justify-between border-b border-gray-200 px-5">
            <h2 id="talent-profile-heading" className="text-sm font-semibold">Perfil do Profissional</h2>
            <Button autoFocus variant="ghost" aria-label="Fechar perfil" onClick={() => setSelected(null)} className="px-3 text-xl">×</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="bg-orange-50 p-5">
              <div className="flex w-full flex-wrap items-start gap-3 text-gray-950">
                <div className="flex min-w-0 flex-wrap items-start gap-3">
                  <PersonPhoto talent={selected} large onClick={() => {}} />
                  <div className="min-w-0 flex-1 basis-40"><h3 className="flex items-center text-xl font-semibold"><span className="min-w-0 break-words">{selected.name}</span><ProfessionalVerification userId={selected.id} /></h3><p className="break-words text-sm text-gray-700">{selected.specialties?.[0] || 'Profissional'}</p></div>
                </div>
                <span className="w-full break-words text-xs text-gray-700">{location || 'Cidade não compartilhada'}</span>
              </div>
            </div>
            <div className="space-y-6 p-5">
              {!approveTarget && errorFeedback}
              {notice && <Toast tone="info" onDismiss={() => setNotice('')}>{notice}</Toast>}
              {hireResult}
              {(selected.categories.includes('favorite') || selected.categories.includes('interest')) && <div className="flex flex-wrap gap-2">
                {selected.categories.includes('favorite') && <Badge>❤️ Favorito</Badge>}
                {selected.categories.includes('interest') && <Badge>👀 Interesse</Badge>}
              </div>}
              {selected.restaurant_operations > 0 && <section className="rounded-2xl bg-emerald-50 p-4">
                <p className="text-sm font-semibold">✅ Você já contratou este profissional {selected.restaurant_operations} {selected.restaurant_operations === 1 ? 'vez' : 'vezes'}.</p>
                <p className="mt-1 text-xs text-gray-600">Última contratação: {relativeTime(selected.last_hired_at) ?? '—'}</p>
                <Button variant="secondary" disabled={historyLoading} onClick={() => void toggleHistory()} className="mt-3 px-3 text-xs">{historyLoading ? 'Carregando...' : historyOpen && allHistory?.workerId === selected.id ? 'Ocultar histórico' : 'Ver histórico de operações'}</Button>
                {historyError && <Toast tone="warning" title="Não foi possível carregar o histórico."><p>{historyError}</p><Button onClick={() => void toggleHistory()}>Recarregar histórico</Button></Toast>}
                {historyOpen && <ul className="mt-3 space-y-2 border-t border-emerald-200 pt-3">
                  {(allHistory?.workerId === selected.id ? allHistory.rows : selected.history).map((operation, index) => <li key={`${operation.job_date}-${index}`} className="text-xs text-gray-700"><b>{operation.title}</b> · {formatDate(operation.job_date)} · {operation.status}</li>)}
                </ul>}
              </section>}
              {selected.restaurant_operations === 0 && <p className="text-sm text-gray-600">Sem contratações anteriores com você.</p>}

              <section>
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Avaliações de restaurantes</h3>
                  {selected.review_count !== null && selected.review_count > 0 && <Button variant="ghost" disabled={reviewLoading} onClick={() => void toggleReviews()} className="min-h-9 px-2 text-xs text-orange-700">{reviewLoading ? 'Carregando...' : reviewExpanded && allReviews?.workerId === selected.id ? 'Ocultar avaliações' : `Ver todas avaliações (${selected.review_count})`}</Button>}
                  {selected.review_count === null && <span className="text-xs text-gray-500">Privadas</span>}
                </div>
                <p className="mt-2 text-sm text-gray-700">Avaliação média: {average == null ? 'Sem dados compartilhados' : `${Number(average).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 5`}</p>
                {reviewError && <Toast tone="warning" title="Não foi possível carregar as avaliações."><p>{reviewError}</p><Button onClick={() => void toggleReviews()}>Recarregar avaliações</Button></Toast>}
                <div className="mt-3 space-y-3">
                  {(reviewExpanded && allReviews?.workerId === selected.id ? allReviews.rows : selected.reviews).map((review, index) => <article key={`${review.created_at}-${index}`} className="rounded-xl border border-gray-100 p-3">
                    <div className="flex flex-wrap justify-between gap-2 text-xs"><b className="min-w-0 break-words">{review.restaurant_name}</b><span><span className="text-amber-500">★</span> {review.rating} · {formatDate(review.created_at)}</span></div>
                    <p className="mt-2 text-xs leading-5 text-gray-600">{review.comment || 'Sem comentário.'}</p>
                  </article>)}
                  {!selected.reviews.length && <p className="text-sm text-gray-500">{selected.review_count === null ? 'Histórico de avaliações privado.' : 'Nenhuma avaliação compartilhada.'}</p>}
                </div>
              </section>
              <section><h3 className="text-sm font-semibold">Experiência</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{selected.experience || 'Experiência não compartilhada.'}</p></section>
              <section aria-label="Operações" className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 p-4">
                <div><p className="font-semibold">{selected.reputation?.completed ?? '—'}</p><p className="mt-1 break-words text-xs text-gray-600">{selected.reputation ? 'operações concluídas' : 'Sem dados compartilhados'}</p></div>
                <div><p className="font-semibold">{percentage(punctuality)}</p><p className="mt-1 break-words text-xs text-gray-600">pontualidade</p></div>
                <div><p className="font-semibold">{attendance === null ? '—' : percentage(attendance)}</p><p className="mt-1 break-words text-xs text-gray-600">comparecimento</p></div>
              </section>
              {!selected.reputation && average == null && <Badge tone="warning">Dados insuficientes</Badge>}
              <section><h3 className="text-sm font-semibold">Sobre mim</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{selected.bio || 'Descrição profissional não compartilhada.'}</p></section>
              <section><h3 className="text-sm font-semibold">Especialidades</h3><div className="mt-2 flex flex-wrap gap-2">{(selected.specialties ?? []).length ? selected.specialties?.map((item) => <span key={item} className="max-w-full break-words rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700">{item}</span>) : <p className="text-sm text-gray-500">Especialidades não compartilhadas.</p>}</div></section>
            </div>
          </div>
          <div className="shrink-0 space-y-2 border-t border-gray-200 p-4">
            {current && full && <p role="status" className="text-sm text-gray-700"><b>Equipe já formada.</b> Esta operação não está mais recebendo novas contratações.</p>}
            {current && !full && selectedStatus && <p role="status" className="text-sm font-semibold text-gray-700">{selectedStatus === 'candidate' ? 'Aguardando aprovação · Pode ser contratado' : demandStatusLabels[selectedStatus]}</p>}
            {!current && <p className="text-sm text-gray-600">{hiredContext?.workerId === selected.id
              ? 'Contratação confirmada. Acompanhe pelas ações de continuidade acima.'
              : 'Selecione uma operação elegível para convidar este profissional.'}</p>}
            <div className="flex flex-wrap gap-2">
              {selectedRelationship && <Button variant="secondary" aria-label={selectedRelationship.aria} onClick={selectedRelationship.run} disabled={busy !== ''} className="min-w-0 flex-1 basis-32 px-3">{selectedRelationship.label}</Button>}
              {current && !full && (selectedStatus === 'candidate' || selectedStatus === 'accepted')
                && <Button variant="primary" onClick={() => { setError(''); setApproveTarget(selected); }} className="min-w-0 flex-1 basis-32 px-3">Confirmar contratação</Button>}
              {current && recruiting && !full && !selectedStatus && !board.applicationByWorker.has(selected.id)
                && <Button variant="primary" busy={busy === selected.id} disabled={busy !== ''} onClick={() => void invite(selected)} className="min-w-0 flex-1 basis-32 px-3">Convidar para operação</Button>}
              {selectedStatus === 'approved' && current && <Link href={`/restaurant/demands/${current.id}`} className="ec-button px-3">Abrir operação</Link>}
            </div>
          </div>
        </div>
      </dialog>}

      {approveTarget && <dialog ref={(node) => { if (node && !node.open) node.showModal(); }} aria-modal="true" aria-labelledby="approve-heading"
        onCancel={(event) => { if (busy) event.preventDefault(); else setApproveTarget(null); }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md space-y-4 overflow-y-auto rounded-2xl bg-white p-5 text-gray-950 shadow-2xl">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 id="approve-heading" className="font-semibold">Confirmar contratação</h2><p className="mt-1 break-words text-sm text-gray-600">Contratar {approveTarget.name}<ProfessionalVerification userId={approveTarget.id} /> para {current?.job.title}. O chat será liberado após a confirmação.</p></div><Button autoFocus variant="ghost" aria-label="Fechar confirmação" disabled={busy !== ''} onClick={() => setApproveTarget(null)} className="px-2 text-xl">×</Button></div>
          {!current && <p role="status" className="text-sm text-gray-600">O horário de contratação desta operação foi encerrado.</p>}
          {errorFeedback}
          <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy !== ''} onClick={() => setApproveTarget(null)}>Voltar</Button><Button variant="primary" disabled={!current} busy={busy === approveTarget.id} onClick={() => void approve()}>Confirmar contratação</Button></div>
      </dialog>}

      <MobileBottomNav role="restaurant" activeItem="Talentos" showOnDesktop />
    </main>
  );
}
