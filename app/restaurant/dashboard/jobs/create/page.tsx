'use client';

import { Button, Card, Select, TextArea, TextInput, Toast } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { loadPendingReviews, type PendingReview } from '@/lib/operations';

interface AvailableEvent {
  id: string;
  title: string;
  event_date: string;
  revision: number;
}

export default function CreateJobPage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [jobDate, setJobDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [value, setValue] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [events, setEvents] = useState<AvailableEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [reviewsReady, setReviewsReady] = useState(false);

  const router = useRouter();
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    let active = true;
    async function loadEvents() {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !auth.user) { setErrorMessage('Faça login para criar uma demanda.'); return; }
      const reviews = await loadPendingReviews(supabase);
      if (!active) return;
      setPendingReviews(reviews);
      setReviewsReady(true);
      const { data, error } = await supabase.from('events')
        .select('id, title, event_date, revision')
        .eq('restaurant_id', auth.user.id).order('event_date', { ascending: false });
      if (!active) return;
      if (error) setErrorMessage('Não foi possível carregar os eventos. Para vincular uma demanda a um evento, recarregue a página.');
      else {
        setEvents(data ?? []);
        const requested = new URLSearchParams(window.location.search).get('event');
        const selected = data?.find((event) => event.id === requested);
        if (selected) {
          setEventId(selected.id);
          setJobDate(selected.event_date);
        }
      }
    }
    void loadEvents().catch((error) => {
      if (active) setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar os dados para publicação. Recarregue a página.');
    }).finally(() => {
      if (active) setEventsLoading(false);
    });
    return () => { active = false; };
  }, [supabase]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || eventsLoading || !reviewsReady || pendingReviews.length || publishedId) return;
    setLoading(true);
    setErrorMessage('');

    try {
      const selectedEvent = eventId
        ? events.find((event) => event.id === eventId)
        : undefined;

      if (eventId && !selectedEvent) {
        throw new Error('Evento indisponível. Recarregue a página e selecione novamente.');
      }

      const amount = Number(value);
      if (value.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Informe um valor de diária maior que zero.');
      }
      const required = Number(quantity);
      if (!Number.isInteger(required) || required < 1 || required > 50) {
        throw new Error('Informe de 1 a 50 profissionais.');
      }

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('Sessão expirada. Faça login novamente.');
      const { data: demandId, error } = await supabase.rpc('create_restaurant_demand', {
        p_title: title,
        p_description: description,
        p_job_date: jobDate,
        p_start_time: startTime,
        p_end_time: endTime,
        p_value: amount,
        p_quantity: required,
        p_location_source: selectedEvent ? 'event' : 'none',
        p_work_location_id: null,
        p_location_revision: null,
        p_event_id: selectedEvent?.id ?? null,
        p_event_revision: selectedEvent?.revision ?? null,
      });
      if (error) {
        throw new Error(
          error.code === '40001'
            ? 'O evento foi alterado. Recarregue a página e confira o evento antes de publicar novamente.'
            : error.message,
        );
      }
      if (typeof demandId !== 'string') throw new Error('O serviço não confirmou a demanda criada.');
      setPublishedId(demandId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível publicar a demanda.');
    } finally { setLoading(false); }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:py-12 md:pb-10">
      <Card className="mx-auto max-w-xl space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Nova Demanda</h1>
            <p className="text-sm text-gray-500 mt-1">Uma necessidade operacional. De 1 a 50 profissionais.</p>
          </div>
          <Link
            href="/restaurant/demands"
            className="inline-flex min-h-12 items-center text-sm font-semibold text-gray-600 hover:text-orange-600"
          >
            ← Voltar
          </Link>
        </div>

        {errorMessage && (
          <Toast tone="error">{errorMessage}</Toast>
        )}

        {publishedId ? <section className="space-y-5">
          <Toast tone="success">Demanda publicada com sucesso. Os convites são opcionais e não alteram a publicação.</Toast>
          <h2 className="text-xl font-semibold">Convidar profissionais da sua Rede de Talentos</h2>
          <Link href={`/restaurant/demands/${publishedId}?view=talents`} className="ec-button ec-button--primary w-full px-4">Convidar Agora</Link>
          <Button onClick={() => { router.push(`/restaurant/demands/${publishedId}`); router.refresh(); }} className="w-full px-4">Pular</Button>
        </section> : pendingReviews.length ? <section className="space-y-3">
          <Toast tone="info">Antes de criar uma nova demanda, avalie sua última experiência.</Toast>
          {pendingReviews.map((review) => <Link key={review.job_id} href={`/reviews/${review.job_id}`} className="ec-button ec-button--primary w-full px-4">Avaliar {review.reviewed_name} · {review.title}</Link>)}
        </section> : <form onSubmit={handleCreateJob} className="space-y-4">
          <fieldset disabled={loading || eventsLoading || !reviewsReady} className="min-w-0 space-y-4">
          <div>
            <label htmlFor="field-restaurant-dashboard-jobs-create-page-tsx-1" className="block text-sm font-medium text-gray-700 mb-1">Nome da demanda</label>
            <TextInput id="field-restaurant-dashboard-jobs-create-page-tsx-1"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Cozinheiro(a), Garçom, Auxiliar"
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="demand-quantity" className="mb-1 block text-sm font-medium text-gray-700">Profissionais necessários</label>
            <TextInput id="demand-quantity" type="number" min={1} max={50} step={1} required value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </div>

          <div>
            <label htmlFor="field-restaurant-dashboard-jobs-create-page-tsx-2" className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <TextArea id="field-restaurant-dashboard-jobs-create-page-tsx-2"
              rows={4}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva as atribuições, uniforme exigido e detalhes do plantão..."
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="field-restaurant-dashboard-jobs-create-page-tsx-3" className="block text-sm font-medium text-gray-700 mb-1">Data</label>
            <TextInput id="field-restaurant-dashboard-jobs-create-page-tsx-3"
              type="date"
              required
              value={jobDate}
              onChange={(e) => setJobDate(e.target.value)}
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="job-event" className="mb-1 block text-sm font-semibold">Evento vinculado (opcional)</label>
            <Select id="job-event" value={eventId} disabled={loading} className="w-full" onChange={(event) => {
              setEventId(event.target.value);
              const selected = events.find((item) => item.id === event.target.value);
              if (selected) {
                setJobDate(selected.event_date);
              }
            }}>
              <option value="">{eventsLoading ? 'Carregando eventos...' : 'Demanda independente'}</option>
              {events.map((event) => <option key={event.id} value={event.id}>{event.title} · {event.event_date}</option>)}
            </Select>
            <p className="mt-1 text-sm text-gray-600">
              {eventId
                ? 'A demanda receberá uma cópia do local do evento, mesmo sem coordenadas. Alterações posteriores no evento não modificarão esta demanda.'
                : 'A demanda será criada sem local definido.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="field-restaurant-dashboard-jobs-create-page-tsx-4" className="block text-sm font-medium text-gray-700 mb-1">Horário Inicial</label>
              <TextInput id="field-restaurant-dashboard-jobs-create-page-tsx-4"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="field-restaurant-dashboard-jobs-create-page-tsx-5" className="block text-sm font-medium text-gray-700 mb-1">Horário Final</label>
              <TextInput id="field-restaurant-dashboard-jobs-create-page-tsx-5"
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          <div>
            <label htmlFor="field-restaurant-dashboard-jobs-create-page-tsx-6" className="block text-sm font-medium text-gray-700 mb-1">Diária por profissional (R$)</label>
            <TextInput id="field-restaurant-dashboard-jobs-create-page-tsx-6"
              type="number"
              inputMode="decimal"
              step="0.01"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ex: 180.00"
              className="w-full"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Link
              href="/restaurant/demands"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancelar
            </Link>
            <Button variant="primary"
              type="submit"
              disabled={loading}
              busy={loading}
              className="inline-flex items-center justify-center px-6 py-2.5 text-sm shadow-sm"
            >
              {loading ? 'Publicando...' : 'Publicar Demanda'}
            </Button>
          </div>
          </fieldset>
        </form>}
      </Card>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}