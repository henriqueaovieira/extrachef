'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, LoadingSkeleton, TextInput, Toast } from '@/app/components/ui';
import DemandPersonSummary from '@/app/components/demand-person';
import { createClient } from '@/lib/supabase/client';
import { loadDemandPeople, signDemandPhotos, type DemandPerson } from '@/lib/demand-detail';

const categories = [['all', 'Todos'], ['contact', 'Contatos'], ['known', 'Conhecidos'], ['recurring', 'Recorrentes'], ['favorite', 'Favoritos'], ['partner', 'Parceiros']] as const;

export default function DemandTalentNetwork({ demandId, canInvite }: { demandId: string; canInvite: boolean }) {
  const [people, setPeople] = useState<DemandPerson[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [limit, setLimit] = useState(20);
  const [supabase] = useState(() => createClient());
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true); setError(''); setMediaError('');
      try {
        let loaded = await loadDemandPeople(supabase, demandId, undefined, false);
        try { loaded = await signDemandPhotos(supabase, loaded); }
        catch (error) { if (mounted) setMediaError(error instanceof Error ? error.message : 'Não foi possível carregar fotos.'); }
        if (mounted) setPeople(loaded);
      } catch (error) {
        if (mounted) setError(error instanceof Error ? error.message : 'Não foi possível carregar a rede.');
      } finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, [demandId, retry, supabase]);

  const mutate = async (person: DemandPerson, category?: string) => {
    if (busy) return;
    if (!category && !canInvite) {
      setError('O recrutamento desta operação foi encerrado.');
      return;
    }
    setBusy(person.id); setError(''); setNotice('');
    try {
      const enabled = category ? !person.categories.includes(category) : false;
      const result = category
        ? await supabase.rpc('set_talent_connection', { p_worker_id: person.id, p_category: category, p_enabled: enabled })
        : await supabase.rpc('invite_demand_worker', { p_demand_id: demandId, p_worker_id: person.id });
      if (result.error) throw new Error(result.error.message);
      setPeople((current) => current.map((item) => item.id !== person.id ? item : category
        ? { ...item, categories: enabled ? [...item.categories, category] : item.categories.filter((value) => value !== category) }
        : { ...item, invitation_status: 'pending' }));
      setNotice(category ? 'Rede atualizada.' : `Convite enviado para ${person.name}. O aceite gera uma candidatura, não uma contratação automática.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
    } finally { setBusy(null); }
  };
  const visible = people.filter((person) => (filter === 'all' || (filter === 'recurring' ? person.completed_operations >= 2 : person.categories.includes(filter)))
    && `${person.name} ${person.specialties?.join(' ') ?? ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return (
    <section className="space-y-5">
      <header><h1 className="text-2xl font-semibold tracking-tight">Rede de Talentos</h1><p className="mt-2 text-sm leading-6 text-gray-500">Convide quem você já conhece ou encontre novos profissionais. O profissional precisa aceitar o convite.</p></header>
      <label className="block text-sm font-medium">Buscar profissional<TextInput type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(20); }} placeholder="Nome ou especialidade" className="mt-2" /></label>
      <div role="group" aria-label="Filtrar rede de talentos" className="flex gap-2 overflow-x-auto pb-2">
        {categories.map(([value, label]) => <Button key={value} variant={filter === value ? 'primary' : 'secondary'} aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(20); }} className="shrink-0 px-3 text-xs">{label}</Button>)}
      </div>
      {error && <Toast tone="error"><p>{error}</p><Button variant="ghost" className="px-0 underline" onClick={() => setRetry((value) => value + 1)}>Tentar Novamente</Button></Toast>}
      {mediaError && <Toast tone="info">{mediaError}</Toast>}
      {notice && <Toast tone="info">{notice}</Toast>}
      {loading ? <LoadingSkeleton label="Carregando rede de talentos..." /> : visible.length ? <div className="space-y-3">
        {visible.slice(0, limit).map((person) => <article key={person.id} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4">
          <DemandPersonSummary person={person} profileHref={`/restaurant/demands/${demandId}?view=profile&person=${person.id}`} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={`/restaurant/demands/${demandId}?view=profile&person=${person.id}`} className="inline-flex min-h-11 items-center text-xs font-semibold">Ver Perfil</Link>
            <Button variant="primary" disabled={!canInvite || busy !== null || person.invitation_status !== null} busy={busy === person.id} onClick={() => void mutate(person)} className="px-4 text-xs">{!canInvite ? 'Recrutamento encerrado' : person.invitation_status === 'pending' ? 'Convite enviado' : person.invitation_status === 'accepted' ? 'Convite aceito' : person.invitation_status === 'declined' ? 'Convite recusado' : 'Convidar'}</Button>
          </div>
          <details className="border-t border-gray-100"><summary className="min-h-11 cursor-pointer content-center text-xs text-gray-500">Organizar na minha rede</summary>
            <div className="flex flex-wrap gap-2">{categories.filter(([value]) => value !== 'all' && value !== 'recurring').map(([value, label]) => <Button key={value} aria-pressed={person.categories.includes(value)} disabled={busy !== null} onClick={() => void mutate(person, value)} className={`px-3 text-xs ${person.categories.includes(value) ? 'bg-orange-50' : ''}`}>{label}</Button>)}</div>
            <p className="mt-3 text-xs text-gray-500">Recorrentes: duas ou mais operações concluídas com sua empresa.</p>
          </details>
        </article>)}
        {visible.length > limit && <Button onClick={() => setLimit((value) => value + 20)} className="px-4">Ver mais profissionais</Button>}
      </div> : !error ? <EmptyState title="Nenhum profissional neste filtro." description="Busque por outro nome ou explore todos os talentos." /> : null}
    </section>
  );
}
