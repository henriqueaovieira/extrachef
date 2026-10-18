'use client';

import { Badge, Button, Card, EmptyState, LoadingSkeleton, Select, TextArea, TextInput, Toast } from '@/app/components/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { catalogLocationColumns, type CatalogLocation } from '@/lib/work-locations';
import { eventLocationColumns, eventLocationLabels, eventLocationParameters, type EventLocationSnapshot } from '@/lib/event-locations';

type EventStatus = 'scheduled' | 'cancelled' | 'completed';
type EventFilter = 'all' | 'upcoming' | 'past' | EventStatus;

interface RestaurantEvent extends EventLocationSnapshot {
  id: string;
  restaurant_id: string;
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  expected_people: number;
  status: EventStatus;
  created_at: string;
  updated_at: string;
  revision: number;
}

interface EventForm {
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  expected_people: string;
  status: EventStatus;
}

const emptyForm: EventForm = {
  title: '',
  description: '',
  event_date: '',
  start_time: '',
  end_time: '',
  expected_people: '',
  status: 'scheduled',
};

const filterOptions: Array<{ value: EventFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'upcoming', label: 'Futuros' },
  { value: 'past', label: 'Anteriores' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'cancelled', label: 'Cancelados' },
];

const statusLabels: Record<EventStatus, string> = {
  scheduled: 'Agendado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
};

const eventColumns = `id, restaurant_id, title, description, event_date, start_time, end_time, expected_people, status, created_at, updated_at, revision, ${eventLocationColumns}`;

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatEventDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export default function RestaurantEvents() {
  const [supabase] = useState(() => createClient());
  const [restaurantId, setRestaurantId] = useState('');
  const [events, setEvents] = useState<RestaurantEvent[]>([]);
  const [today, setToday] = useState('');
  const [form, setForm] = useState<EventForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [locations, setLocations] = useState<CatalogLocation[]>([]);
  const [locationChoice, setLocationChoice] = useState('none');
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState('');
  const [eventsError, setEventsError] = useState('');
  const [editingEvent, setEditingEvent] = useState<RestaurantEvent | null>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(false);

  const loadEvents = useCallback(async (currentRestaurantId: string) => {
    const all: RestaurantEvent[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.from('events').select(eventColumns)
        .eq('restaurant_id', currentRestaurantId).order('event_date').order('start_time').order('id')
        .range(offset, offset + 99);
      if (error) throw new Error(`Não foi possível carregar os eventos. Confira a migration de snapshots de eventos. ${error.message}`);
      all.push(...(data ?? []));
      if (!data || data.length < 100) break;
    }
    if (mounted.current) { setEvents(all); setEventsError(''); }
  }, [supabase]);

  const loadLocations = useCallback(async (currentRestaurantId: string) => {
    setLocationsLoading(true);
    try {
      const all: CatalogLocation[] = [];
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await supabase.from('work_locations').select(catalogLocationColumns)
          .eq('restaurant_id', currentRestaurantId).is('archived_at', null)
          .order('is_default', { ascending: false }).order('name').order('id').range(offset, offset + 99);
        if (error) throw new Error(`Não foi possível consultar o catálogo. ${error.message}`);
        all.push(...(data ?? []));
        if (!data || data.length < 100) break;
      }
      if (mounted.current) { setLocations(all); setLocationsError(''); }
    } catch (error) {
      if (mounted.current) setLocationsError(error instanceof Error ? error.message : 'Não foi possível consultar o catálogo.');
    } finally {
      if (mounted.current) setLocationsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const todayFrame = window.requestAnimationFrame(() => setToday(localDateString(new Date())));
    async function initialize() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !authData.user) {
        setErrorMessage('Entre na conta do restaurante para gerenciar eventos.');
        setLoading(false);
        return;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (!active) return;
      if (userError || userData?.role !== 'restaurant') {
        setErrorMessage('Esta área está disponível apenas para contas de restaurante.');
        setLoading(false);
        return;
      }

      setRestaurantId(authData.user.id);
      try { await loadEvents(authData.user.id); }
      catch (error) {
        if (active) setEventsError(error instanceof Error ? error.message : 'Não foi possível carregar os eventos.');
      }
      // Catalog failures must not block an event without a location or an unchanged snapshot.
      if (active) { setLoading(false); await loadLocations(authData.user.id); }
    }
    void initialize().catch((error: unknown) => {
      if (active) {
        setErrorMessage(error instanceof Error ? error.message : 'Não foi possível iniciar os eventos.');
        setLoading(false);
      }
    });
    return () => {
      active = false;
      mounted.current = false;
      window.cancelAnimationFrame(todayFrame);
    };
  }, [loadEvents, loadLocations, supabase]);

  const resetForm = () => {
    setLocationChoice('none');
    setEditingEvent(null);
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const beginEdit = (event: RestaurantEvent) => {
    setLocationChoice('keep');
    setEditingEvent(event);
    setForm({
      title: event.title,
      description: event.description ?? '',
      event_date: event.event_date,
      start_time: event.start_time.slice(0, 5),
      end_time: event.end_time.slice(0, 5),
      expected_people: String(event.expected_people),
      status: event.status,
    });
    setEditingId(event.id);
    setShowForm(true);
    setErrorMessage('');
    setSuccessMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitEvent = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    if (mutationLock.current) return;
    if (eventsError || loading) {
      setErrorMessage('Atualize os eventos antes de salvar.');
      return;
    }
    if (!restaurantId) {
      setErrorMessage('Entre na conta do restaurante para criar ou editar eventos.');
      return;
    }
    setErrorMessage('');
    setSuccessMessage('');

    const title = form.title.trim();
    const description = form.description.trim();
    const expectedPeople = Number(form.expected_people);
    if (title.length < 2 || title.length > 160) {
      setErrorMessage('Informe um título entre 2 e 160 caracteres.');
      return;
    }
    if (!Number.isInteger(expectedPeople) || expectedPeople < 1 || expectedPeople > 100000) {
      setErrorMessage('O público esperado deve ser um número inteiro maior que zero.');
      return;
    }
    if (form.start_time >= form.end_time) {
      setErrorMessage('O horário final deve ser posterior ao horário inicial.');
      return;
    }

    mutationLock.current = true;
    setSaving(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user || authData.user.id !== restaurantId) {
        setRestaurantId('');
        throw new Error('Sessão expirada ou alterada. Entre novamente na conta do restaurante.');
      }

      if (locationChoice !== 'none' && locationChoice !== 'keep' && (locationsError || locationsLoading)) {
        throw new Error('Atualize o catálogo e confira o local antes de salvar.');
      }
      const { data: savedEvent, error } = await supabase.rpc('save_restaurant_event', {
        p_title: title, p_description: description, p_event_date: form.event_date,
        p_start_time: form.start_time, p_end_time: form.end_time, p_expected_people: expectedPeople,
        p_status: editingId ? form.status : 'scheduled', p_id: editingId,
        p_expected_revision: editingEvent?.revision ?? null,
        ...eventLocationParameters(locationChoice, locations),
      })
        .single<RestaurantEvent>();

      if (error) throw new Error(`Não foi possível salvar o evento: ${error.message}`);

      setEvents((current) => [
        ...current.filter((event) => event.id !== savedEvent.id),
        savedEvent,
      ].sort((first, second) => (
        `${first.event_date}T${first.start_time}`.localeCompare(`${second.event_date}T${second.start_time}`)
      )));
      setSuccessMessage(editingId ? 'Evento atualizado.' : 'Evento criado.');
      resetForm();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar o evento. Tente novamente.');
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };

  const deleteEvent = async (event: RestaurantEvent) => {
    if (!restaurantId || mutationLock.current) return;
    const confirmed = window.confirm(`Excluir o evento “${event.title}”? Esta ação não pode ser desfeita.`);
    if (!confirmed) return;

    mutationLock.current = true;
    setDeletingId(event.id);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || authData.user?.id !== restaurantId) throw new Error('Sessão expirada ou alterada. Recarregue a página.');
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', event.id)
        .eq('restaurant_id', restaurantId).eq('revision', event.revision).select('id').single();
      if (error) throw new Error(`Não foi possível excluir o evento. Ele pode ter sido alterado em outra sessão. Atualize a lista. ${error.message}`);
      setEvents((current) => current.filter((item) => item.id !== event.id));
      setSuccessMessage('Evento excluído.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível excluir o evento.');
    } finally { mutationLock.current = false; setDeletingId(null); }
  };

  const visibleEvents = events.filter((event) => {
    if (filter === 'all') return true;
    if (filter === 'upcoming') return event.event_date >= today && event.status === 'scheduled';
    if (filter === 'past') return event.event_date < today || event.status === 'completed';
    return event.status === filter;
  });
  const selectedLocation = locations.find((location) => location.id === locationChoice);
  const selectionUnavailable = locationChoice !== 'none' && locationChoice !== 'keep' && !selectedLocation;
  const preview = locationChoice === 'keep' ? editingEvent : selectedLocation ? {
    location_name: selectedLocation.name, event_address: selectedLocation.address,
    event_number: selectedLocation.number, event_neighborhood: selectedLocation.neighborhood,
    event_city: selectedLocation.city, event_state: selectedLocation.state,
    event_postal_code: selectedLocation.postal_code,
    location_status: selectedLocation.geocoding_status === 'resolved' ? 'ready' as const : 'pending_coordinates' as const,
  } : null;
  const busy = saving || deletingId !== null;
  const canEdit = !loading && Boolean(restaurantId) && !eventsError && !busy;

  async function refreshEvents() {
    setLoading(true);
    try { await loadEvents(restaurantId); }
    catch (error) { setEventsError(error instanceof Error ? error.message : 'Não foi possível carregar os eventos.'); }
    finally { setLoading(false); }
  }

  return (
    <main className="min-h-dvh bg-[#f5f6f3] px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] text-gray-900 sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/restaurant/more" className="mb-3 inline-flex min-h-9 items-center text-xs font-semibold text-gray-500">← Mais</Link>
            <h1 className="text-2xl font-bold text-gray-950 sm:text-3xl">Eventos</h1>
            <p className="mt-1 text-sm text-gray-600">Organize os eventos do restaurante em um só lugar.</p>
          </div>
          <Button variant="primary"
            type="button"
            disabled={!canEdit}
            onClick={() => {
              setErrorMessage('');
              setSuccessMessage('');
              if (showForm && !editingId) resetForm();
              else {
                setForm(emptyForm);
                setLocationChoice(locations.find((location) => location.is_default)?.id ?? 'none');
                setEditingEvent(null);
                setEditingId(null);
                setShowForm(true);
              }
            }}
            className="inline-flex w-full items-center justify-center px-5 text-sm shadow-sm sm:w-auto"
          >
            {showForm && !editingId ? 'Cancelar' : 'Criar evento'}
          </Button>
        </header>

        {errorMessage && <Toast tone="error">{errorMessage}</Toast>}
        {successMessage && <Toast tone="success">{successMessage}</Toast>}
        {eventsError && <Toast tone="error">{eventsError}</Toast>}
        <div className="flex flex-wrap gap-3">
          <Button disabled={loading || busy || !restaurantId} onClick={() => void refreshEvents()}>Atualizar eventos</Button>
          <Link href="/restaurant/locations" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center font-semibold text-orange-800">Meus Locais (nova aba)</Link>
        </div>

        {showForm && (
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-gray-950">{editingId ? 'Editar evento' : 'Novo evento'}</h2>
            <form
              onSubmit={(event) => void submitEvent(event)}
              onInvalid={() => setErrorMessage('Confira os campos obrigatórios, a data, os horários e o público esperado.')}
              className="mt-5 space-y-4"
            >
              <fieldset disabled={busy || !restaurantId || Boolean(eventsError)} className="min-w-0 space-y-4">
              <div>
                <label htmlFor="event-title" className="mb-1 block text-sm font-semibold text-gray-800">Nome do evento</label>
                <TextInput id="event-title" required minLength={2} maxLength={160} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="w-full" placeholder="Ex.: Festa de lançamento" />
              </div>
              <div>
                <label htmlFor="event-description" className="mb-1 block text-sm font-semibold text-gray-800">Descrição <span className="font-normal text-gray-500">(opcional)</span></label>
                <TextArea id="event-description" maxLength={4000} rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="w-full" placeholder="Detalhes importantes sobre o evento." />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="event-date" className="mb-1 block text-sm font-semibold text-gray-800">Data</label>
                  <TextInput id="event-date" type="date" required min={!editingId ? today : undefined} value={form.event_date} onChange={(event) => setForm((current) => ({ ...current, event_date: event.target.value }))} className="w-full" />
                </div>
                <div>
                  <label htmlFor="event-people" className="mb-1 block text-sm font-semibold text-gray-800">Público esperado</label>
                  <TextInput id="event-people" type="number" required min={1} max={100000} step={1} value={form.expected_people} onChange={(event) => setForm((current) => ({ ...current, expected_people: event.target.value }))} className="w-full" placeholder="Ex.: 80" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="event-start" className="mb-1 block text-sm font-semibold text-gray-800">Início</label>
                  <TextInput id="event-start" type="time" required value={form.start_time} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} className="w-full" />
                </div>
                <div>
                  <label htmlFor="event-end" className="mb-1 block text-sm font-semibold text-gray-800">Término</label>
                  <TextInput id="event-end" type="time" required value={form.end_time} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} className="w-full" />
                </div>
                {editingId && (
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor="event-status" className="mb-1 block text-sm font-semibold text-gray-800">Status</label>
                    <Select id="event-status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as EventStatus }))} className="w-full">
                      <option value="scheduled">Agendado</option>
                      <option value="cancelled">Cancelado</option>
                      <option value="completed">Concluído</option>
                    </Select>
                  </div>
                )}
              </div>
              <section className="space-y-3 rounded-xl border border-gray-200 p-4" aria-labelledby="event-location-heading">
                <h3 id="event-location-heading" className="font-semibold">Local do evento (opcional)</h3>
                <label htmlFor="event-location" className="block text-sm font-semibold">Selecionar local</label>
                <Select id="event-location" className="w-full" value={locationChoice}
                  onChange={(event) => setLocationChoice(event.target.value)}>
                  {editingId && <option value="keep">Manter local salvo neste evento</option>}
                  <option value="none">Definir depois / sem local</option>
                  {selectionUnavailable && <option value={locationChoice} disabled>Local selecionado indisponível — escolha novamente</option>}
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} — {location.address}{location.number ? `, ${location.number}` : ''} — {location.city}/{location.state}{location.is_default ? ' (padrão)' : ''}
                    </option>
                  ))}
                </Select>
                {locationsLoading && <p role="status" className="text-sm text-gray-600">Atualizando catálogo...</p>}
                {locationsError && <Toast tone="error">{locationsError} Você ainda pode salvar sem local ou manter o snapshot existente.</Toast>}
                {!locationsLoading && !locationsError && locations.length === 0 && (
                  <p className="text-sm text-gray-600">Nenhum local ativo no catálogo. Cadastre em Meus Locais ou defina depois.</p>
                )}
                {preview ? (
                  <div className="space-y-2">
                    <Badge tone={preview.location_status === 'ready' ? 'success' : 'warning'}>{eventLocationLabels[preview.location_status]}</Badge>
                    {preview.event_address && <p className="break-words text-sm text-gray-700">{preview.location_name} · {preview.event_address}{preview.event_number ? `, ${preview.event_number}` : ''}{preview.event_neighborhood ? ` — ${preview.event_neighborhood}` : ''} · {preview.event_city}/{preview.event_state}{preview.event_postal_code ? ` · CEP ${preview.event_postal_code}` : ''}</p>}
                  </div>
                ) : selectionUnavailable
                  ? <Toast tone="error">O local selecionado não está mais disponível. Escolha outro local ou defina depois.</Toast>
                  : <Badge>Local não definido</Badge>}
                <p className="text-sm text-gray-600">O endereço é copiado ao salvar. Alterações no catálogo não mudam este evento. Não é necessário GPS nem geocodificação.</p>
                {selectedLocation?.is_default && <p className="text-sm text-gray-600">Seu local padrão está selecionado. Você pode trocar ou definir depois.</p>}
                <div className="flex flex-wrap gap-3">
                  <Button disabled={locationsLoading} onClick={() => void loadLocations(restaurantId)}>Atualizar catálogo</Button>
                  <Link href="/restaurant/locations" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center font-semibold text-orange-800">Cadastrar local (nova aba)</Link>
                </div>
                <p className="text-sm text-gray-600">Após cadastrar na nova aba, use Atualizar catálogo. Os dados deste formulário serão preservados. Ao editar, “Manter” preserva o local original; selecionar um item do catálogo copia a versão atual, inclusive do mesmo local.</p>
              </section>
              <div className="flex flex-col-reverse gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:justify-end">
                <Button type="button" onClick={resetForm} className="min-h-12 rounded-xl border border-gray-300 px-5 text-sm font-semibold text-gray-700">Cancelar</Button>
                <Button variant="primary" type="submit" busy={saving} disabled={saving || !restaurantId} className="px-5 text-sm">
                  {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar evento'}
                </Button>
              </div>
              </fieldset>
            </form>
          </section>
        )}

        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar eventos">
          {filterOptions.map((option) => (
            <Button key={option.value} type="button" onClick={() => setFilter(option.value)} aria-pressed={filter === option.value} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${filter === option.value ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}>
              {option.label}
            </Button>
          ))}
        </div>

        {loading ? (
          <LoadingSkeleton label="Carregando eventos..." />
        ) : eventsError ? null : visibleEvents.length === 0 ? (
          <EmptyState icon="▦" title={events.length ? 'Nenhum evento neste filtro' : 'Seu próximo evento começa aqui'}
            description={events.length ? 'Experimente outro filtro para encontrar seus eventos.' : 'Crie seu primeiro evento e organize os detalhes da sua operação.'}
            action={events.length
              ? <Button onClick={() => setFilter('all')}>Ver todos os eventos</Button>
              : <Button variant="primary" disabled={!canEdit} onClick={() => {
                resetForm(); setLocationChoice(locations.find((location) => location.is_default)?.id ?? 'none'); setShowForm(true);
              }}>Criar primeiro evento</Button>} />
        ) : (
          <section className="grid gap-4 md:grid-cols-2">
            {visibleEvents.map((event) => (
              <Card as="article" key={event.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">{formatEventDate(event.event_date)}</p>
                    <h2 className="mt-1 break-words text-lg font-bold text-gray-950">{event.title}</h2>
                  </div>
                  <Badge className="shrink-0" tone={event.status === 'scheduled' ? 'success' : event.status === 'cancelled' ? 'danger' : 'neutral'}>
                    {statusLabels[event.status]}
                  </Badge>
                </div>
                <p className="mt-3 text-sm font-medium text-gray-700">{event.start_time.slice(0, 5)}–{event.end_time.slice(0, 5)} · {event.expected_people} pessoas esperadas</p>
                <div className="mt-3 space-y-2">
                  <Badge tone={event.location_status === 'ready' ? 'success' : event.location_status === 'pending_coordinates' ? 'warning' : 'neutral'}>{eventLocationLabels[event.location_status]}</Badge>
                  {event.event_address && <p className="break-words text-sm text-gray-700">{event.location_name} · {event.event_address}{event.event_number ? `, ${event.event_number}` : ''}{event.event_neighborhood ? ` — ${event.event_neighborhood}` : ''} · {event.event_city}/{event.event_state}{event.event_postal_code ? ` · CEP ${event.event_postal_code}` : ''}</p>}
                </div>
                {event.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-600">{event.description}</p>}
                <div className="mt-5 flex gap-3 border-t border-gray-100 pt-4">
                  <Button type="button" disabled={!canEdit || showForm} onClick={() => beginEdit(event)} className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">Editar</Button>
                  <Button type="button" onClick={() => void deleteEvent(event)} disabled={!canEdit || showForm} className="min-h-11 flex-1 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                    {deletingId === event.id ? 'Excluindo...' : 'Excluir'}
                  </Button>
                </div>
              </Card>
            ))}
          </section>
        )}
      </section>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}
