'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { catalogLocationColumns, emptyLocationForm, geocodingLabels, locationParameters, type CatalogLocation, type LocationAction, type LocationForm } from '@/lib/work-locations';
import { Badge, Button, Card, EmptyState, LoadingSkeleton, MaskedInput, Select, TextInput, Toast } from '@/app/components/ui';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';

export default function RestaurantLocations() {
  const [supabase] = useState(() => createClient());
  const [ownerId, setOwnerId] = useState('');
  const [locations, setLocations] = useState<CatalogLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<LocationForm>(emptyLocationForm);
  const [editing, setEditing] = useState<CatalogLocation | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const mutationLock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const mounted = useRef(false);

  const reload = useCallback(async () => {
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) throw new Error('Sessão expirada. Entre novamente na conta do restaurante.');
    const { data: profile, error: profileError } = await supabase.from('users').select('role').eq('id', auth.user.id).single();
    if (profileError) throw new Error('Não foi possível validar seu perfil.');
    if (profile.role !== 'restaurant') throw new Error('Somente restaurantes podem gerenciar locais.');
    const all: CatalogLocation[] = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from('work_locations').select(catalogLocationColumns)
        .eq('restaurant_id', auth.user.id).order('is_default', { ascending: false })
        .order('name').order('id').range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Não foi possível carregar seus locais. Verifique a migration do catálogo. ${error.message}`);
      all.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }
    if (mounted.current) {
      setOwnerId(auth.user.id);
      setLocations(all);
      setLoadError('');
    }
    return auth.user.id;
  }, [supabase]);

  const load = useCallback(async () => {
    try { await reload(); }
    catch (failure) {
      if (mounted.current) {
        setOwnerId('');
        setLocations([]);
        setLoadError(failure instanceof Error ? failure.message : 'Não foi possível carregar seus locais.');
      }
    } finally { if (mounted.current) setLoading(false); }
  }, [reload]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  function openForm(location: CatalogLocation | null) {
    setEditing(location);
    setForm(location ? {
      name: location.name, address: location.address, number: location.number,
      neighborhood: location.neighborhood, city: location.city,
      state: location.state, postal_code: location.postal_code,
    } : emptyLocationForm);
    setShowForm(true);
    setError(''); setSuccess('');
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: 'start' });
      formRef.current?.querySelector('input')?.focus();
    });
  }

  async function verifyOwner() {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || data.user.id !== ownerId) {
      throw new Error('Sessão expirada ou alterada. Recarregue a página antes de continuar.');
    }
  }

  async function mutate(operation: () => Promise<void>, message: string) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setError(''); setSuccess('');
    let committed = false;
    try {
      await verifyOwner();
      await operation();
      committed = true;
      setShowForm(false); setEditing(null); setForm(emptyLocationForm);
      setSuccess(message);
      await reload();
    } catch (failure) {
      const detail = failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.';
      if (committed) {
        setLoadError(`A alteração foi salva, mas a lista não pôde ser atualizada. Recarregue antes de continuar. ${detail}`);
        setOwnerId('');
      } else setError(detail);
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(async () => {
      const parameters = locationParameters(form, editing);
      const { error } = await supabase.rpc('save_work_location', parameters);
      if (error) throw new Error(`Não foi possível salvar o local: ${error.message}`);
    }, editing ? 'Local atualizado.' : 'Local cadastrado. As coordenadas podem ser configuradas em uma próxima etapa.');
  }

  async function manage(location: CatalogLocation, action: LocationAction) {
    if (action === 'delete' && !window.confirm(`Excluir definitivamente “${location.name}”? Esta ação não pode ser desfeita.`)) return;
    if (action === 'archive' && !window.confirm(`Arquivar “${location.name}”? ${location.is_default ? 'Ele deixará de ser o local padrão. ' : ''}Você poderá restaurá-lo depois.`)) return;
    const messages: Record<LocationAction, string> = {
      set_default: 'Local padrão atualizado.', unset_default: 'Local padrão removido.',
      archive: 'Local arquivado.', restore: 'Local restaurado. O padrão anterior não foi alterado.',
      delete: 'Local excluído definitivamente.',
    };
    await mutate(async () => {
      const { error } = await supabase.rpc('manage_work_location', {
        p_id: location.id, p_action: action, p_expected_revision: location.revision,
      });
      if (error) throw new Error(error.code === '23503'
        ? 'Este local já foi utilizado em eventos e não pode ser excluído. Mantenha-o arquivado para preservar o histórico.'
        : `Não foi possível atualizar o local: ${error.message}`);
    }, messages[action]);
  }

  const query = search.trim().toLocaleLowerCase('pt-BR');
  const visible = locations.filter((location) => (
    (filter === 'all' || (filter === 'archived' ? location.archived_at !== null : location.archived_at === null))
    && `${location.name} ${location.address} ${location.city} ${location.state}`.toLocaleLowerCase('pt-BR').includes(query)
  ));
  const disabled = busy || loading || !ownerId || Boolean(loadError);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 md:pb-10">
      <section className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/restaurant/more" className="mb-3 inline-flex min-h-9 items-center text-xs font-semibold text-gray-500">← Mais</Link>
            <h1 className="text-2xl font-bold text-gray-950">Meus Locais</h1>
            <p className="mt-2 text-sm text-gray-600">Cadastre endereços uma vez e selecione-os nos eventos. Alterar o catálogo não muda eventos existentes. Vagas ainda não estão integradas.</p>
          </div>
          <Button variant="primary" disabled={disabled || showForm} onClick={() => openForm(null)}>Cadastrar local</Button>
        </header>
        <Toast tone="info">O cadastro não exige GPS nem geocodificação. Nesta etapa, novos locais ficam com coordenadas pendentes.</Toast>
        {error && <Toast tone="error">{error}</Toast>}
        {success && <Toast tone="success">{success}</Toast>}
        {loadError && <Toast tone="error">{loadError}</Toast>}
        <Button disabled={busy || loading} onClick={() => { setLoading(true); void load(); }}>Atualizar lista</Button>
        {showForm && (
          <Card>
            <h2 className="text-lg font-bold">{editing ? 'Editar local' : 'Cadastrar local'}</h2>
            <form ref={formRef} onSubmit={(event) => void save(event)} className="mt-4">
              <fieldset disabled={disabled} className="min-w-0 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {([
                    ['name', 'Nome do local', 160, true, 'Ex.: Hotel Fazenda'],
                    ['address', 'Endereço / rodovia e km', 300, true, 'Ex.: Rodovia SP-304 km 20'],
                    ['number', 'Número (opcional)', 30, false, '120 ou s/n'],
                    ['neighborhood', 'Bairro (opcional)', 120, false, 'Centro'],
                    ['city', 'Cidade', 120, true, 'Piracicaba'],
                    ['state', 'UF', 2, true, 'SP'],
                  ] as const).map(([field, label, maxLength, required, placeholder]) => (
                    <div key={field}>
                      <label htmlFor={`catalog-${field}`} className="mb-1 block text-sm font-semibold">{label}</label>
                      <TextInput id={`catalog-${field}`} value={form[field]} required={required}
                        minLength={field === 'address' ? 3 : required ? 2 : undefined} maxLength={maxLength}
                        placeholder={placeholder} className="w-full"
                        autoComplete={field === 'city' ? 'address-level2' : field === 'state' ? 'address-level1' : field === 'address' ? 'street-address' : 'off'}
                        onChange={(event) => setForm((current) => ({ ...current, [field]: field === 'state' ? event.target.value.toUpperCase() : event.target.value }))} />
                    </div>
                  ))}
                  <div>
                    <label htmlFor="catalog-postal" className="mb-1 block text-sm font-semibold">CEP (opcional)</label>
                    <MaskedInput id="catalog-postal" mask="postal-code" value={form.postal_code}
                      autoComplete="postal-code" className="w-full"
                      onValueChange={(value) => setForm((current) => ({ ...current, postal_code: value }))} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" variant="primary" busy={busy}>Salvar local</Button>
                  <Button onClick={() => { setShowForm(false); setEditing(null); }}>Cancelar</Button>
                </div>
              </fieldset>
            </form>
          </Card>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="catalog-search" className="mb-1 block text-sm font-semibold">Buscar local</label>
            <TextInput id="catalog-search" type="search" className="w-full" value={search}
              placeholder="Nome, endereço ou cidade" onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div>
            <label htmlFor="catalog-filter" className="mb-1 block text-sm font-semibold">Exibir</label>
            <Select id="catalog-filter" className="w-full" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="active">Ativos</option><option value="archived">Arquivados</option><option value="all">Todos</option>
            </Select>
          </div>
        </div>
        {loading ? <LoadingSkeleton label="Carregando seus locais" /> : loadError ? null : visible.length === 0 ? (
          <EmptyState title={locations.length ? 'Nenhum local neste filtro' : 'Cadastre seu primeiro local'}
            description={locations.length ? 'Altere a busca ou o filtro para encontrar seus locais.' : 'Salve os endereços da sua operação sem depender de coordenadas.'} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {visible.map((location) => (
              <Card as="article" key={location.id} className="min-w-0 space-y-3">
                <h2 className="break-words text-lg font-bold">{location.name}</h2>
                <div className="flex flex-wrap gap-2">
                  {location.is_default && <Badge tone="success">Padrão</Badge>}
                  {location.archived_at && <Badge>Arquivado</Badge>}
                  <Badge tone={location.geocoding_status === 'resolved' ? 'success' : 'warning'}>{geocodingLabels[location.geocoding_status]}</Badge>
                </div>
                <p className="break-words text-sm text-gray-700">{location.address}{location.number ? `, ${location.number}` : ''}{location.neighborhood ? ` — ${location.neighborhood}` : ''}</p>
                <p className="text-sm text-gray-700">{location.city}/{location.state}{location.postal_code ? ` · CEP ${location.postal_code}` : ''}</p>
                <div className="flex flex-wrap gap-2">
                  {location.archived_at ? (
                    <>
                      <Button disabled={disabled || showForm} onClick={() => void manage(location, 'restore')}>Restaurar</Button>
                      <Button variant="danger" disabled={disabled || showForm} onClick={() => void manage(location, 'delete')}>Excluir definitivamente</Button>
                    </>
                  ) : (
                    <>
                      <Button disabled={disabled || showForm} onClick={() => openForm(location)}>Editar</Button>
                      <Button disabled={disabled || showForm} onClick={() => void manage(location, location.is_default ? 'unset_default' : 'set_default')}>
                        {location.is_default ? 'Remover padrão' : 'Definir como padrão'}
                      </Button>
                      <Button disabled={disabled || showForm} onClick={() => void manage(location, 'archive')}>Arquivar</Button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}
