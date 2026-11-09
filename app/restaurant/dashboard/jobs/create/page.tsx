'use client';

import ProfessionalVerification from '@/app/components/professional-verification';

import { Button, Card, Select, TextArea, TextInput, Toast } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import LocationForm from '@/app/components/location-form';
import { loadPendingReviews, type PendingReview } from '@/lib/operations';
import { commonSpecialties } from '@/lib/specialties';
import { loadWorkLocations } from '@/lib/locations/client';
import {
  formatLocationAddress, locationHasOperationalCoordinates, locationSelectable, type CatalogLocation,
} from '@/lib/work-locations';
import { recruitmentWindow } from '@/lib/demands';

export default function CreateJobPage() {
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [jobDate, setJobDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [value, setValue] = useState('');
  const [locations, setLocations] = useState<CatalogLocation[] | null>(null);
  const [locationId, setLocationId] = useState('');
  const [addingLocation, setAddingLocation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [reviewsReady, setReviewsReady] = useState(false);

  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const publicationWindow = jobDate && startTime && endTime
    ? recruitmentWindow({ job_date: jobDate, start_time: startTime, end_time: endTime, created_at: new Date().toISOString() })
    : null;
  const selectable = (locations ?? []).filter((location) => locationSelectable(location, jobDate));
  const selectedLocation = selectable.find((location) => location.id === locationId)
    ?? selectable.find((location) => location.is_default) ?? selectable[0] ?? null;
  const pendingLocations = (locations ?? []).filter((location) => !location.archived_at && !locationHasOperationalCoordinates(location));

  const rememberLocation = (location: CatalogLocation) => {
    setLocations((current) => [location, ...(current ?? []).filter((item) => item.id !== location.id)]);
    if (locationSelectable(location, jobDate)) {
      setLocationId(location.id);
      setAddingLocation(false);
    }
  };

  useEffect(() => {
    let active = true;
    async function initialize() {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !auth.user) { setErrorMessage('Faça login para criar uma operação.'); return; }
      const [reviews, catalog] = await Promise.all([loadPendingReviews(supabase), loadWorkLocations(supabase, auth.user.id)]);
      if (!active) return;
      setPendingReviews(reviews);
      setLocations(catalog);
      setReviewsReady(true);
    }
    void initialize().catch((error) => {
      if (active) setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar os dados para publicação. Recarregue a página.');
    });
    return () => { active = false; };
  }, [supabase]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !reviewsReady || pendingReviews.length || publishedId) return;
    setLoading(true);
    setErrorMessage('');

    try {
      const amount = Number(value);
      if (publicationWindow && publicationWindow.start <= new Date()) {
        throw new Error('Publique a operação antes do horário de início.');
      }
      if (value.trim() === '' || !Number.isFinite(amount) || amount <= 0) {
        throw new Error('Informe um valor de diária maior que zero.');
      }
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('Sessão expirada. Faça login novamente.');
      if (!selectedLocation) throw new Error('Selecione um local com coordenadas operacionais antes de publicar.');
      const { data: demandId, error } = await supabase.rpc('create_restaurant_demand', {
        p_title: role,
        p_description: description,
        p_job_date: jobDate,
        p_start_time: startTime,
        p_end_time: endTime,
        p_value: amount,
        p_location_source: 'catalog',
        p_work_location_id: selectedLocation.id,
        p_location_revision: selectedLocation.revision,
      });
      if (error) throw new Error(error.message);
      if (typeof demandId !== 'string') throw new Error('O serviço não confirmou a operação criada.');
      setPublishedId(demandId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível publicar a operação.');
    } finally { setLoading(false); }
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:py-12 md:pb-10">
      <Card className="mx-auto max-w-xl space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Nova Operação</h1>
            <p className="text-sm text-gray-500 mt-1">Publique uma oportunidade e receba candidaturas de profissionais disponíveis.</p>
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
          <Toast tone="success">Operação publicada com sucesso. Os convites são opcionais e não alteram a publicação.</Toast>
          <h2 className="text-xl font-semibold">Convidar profissionais da sua Rede de Talentos</h2>
          <Link href={`/restaurant/demands/${publishedId}?view=talents`} className="ec-button ec-button--primary w-full px-4">Convidar Agora</Link>
          <Button onClick={() => { router.push(`/restaurant/demands/${publishedId}`); router.refresh(); }} className="w-full px-4">Pular</Button>
        </section> : pendingReviews.length ? <section className="space-y-3">
          <Toast tone="info">Antes de criar uma nova operação, avalie sua última experiência.</Toast>
          {pendingReviews.map((review) => <div key={review.job_id} className="flex items-center"><Link href={`/reviews/${review.job_id}`} className="ec-button ec-button--primary w-full px-4">Avaliar {review.reviewed_name} · {review.title}</Link><ProfessionalVerification jobId={review.job_id} /></div>)}
        </section> : <>
        <fieldset disabled={loading || !reviewsReady} className="min-w-0 space-y-3 rounded-xl border border-gray-200 p-4">
          <legend className="px-1 font-semibold text-gray-900">Onde?</legend>
          {locations === null ? <p className="text-sm text-gray-500" role="status">Carregando locais…</p> : <>
            {selectable.length > 0 ? <div>
              <label htmlFor="operation-location" className="mb-1 block text-sm font-medium text-gray-700">Local da operação</label>
              <Select id="operation-location" value={selectedLocation?.id ?? ''} onChange={(event) => setLocationId(event.target.value)} className="w-full">
                {selectable.map((location) => <option key={location.id} value={location.id}>
                  {location.name}{location.is_default ? ' (principal)' : location.kind === 'temporary' ? ' (temporário)' : ''}
                </option>)}
              </Select>
              {selectedLocation && <p className="mt-1 text-xs text-gray-500">
                {formatLocationAddress(selectedLocation)}
                {selectedLocation.geocoding_precision === 'street' && ' · Precisão aproximada: check-in com raio de até 300 m.'}
                {selectedLocation.geocoding_precision === 'house' && ' · Check-in com raio de até 100 m.'}
              </p>}
            </div> : <Toast tone="info">
              Nenhum local com coordenadas operacionais disponível{jobDate ? ' para esta data' : ''}. Cadastre ou localize um endereço em <Link href="/restaurant/locations" className="underline">Locais operacionais</Link> para publicar.
            </Toast>}
            {pendingLocations.length > 0 && !addingLocation && <p className="text-xs text-gray-500">
              {pendingLocations.length === 1 ? '1 local aguarda localização' : `${pendingLocations.length} locais aguardam localização`} em <Link href="/restaurant/locations" className="underline">Locais operacionais</Link>.
            </p>}
            {addingLocation ? <LocationForm temporaryUntil={jobDate || undefined} allowTemporary={Boolean(jobDate)}
              makeDefault={!(locations ?? []).some((location) => location.is_default && !location.archived_at)}
              onSaved={rememberLocation} onCancel={() => setAddingLocation(false)} />
              : <div className="flex flex-wrap gap-2">
                <Button onClick={() => setAddingLocation(true)}>+ Novo local</Button>
                <Link href="/restaurant/locations" className="ec-button ec-button--ghost px-4">Gerenciar locais</Link>
              </div>}
          </>}
        </fieldset>
        <form onSubmit={handleCreateJob} className="space-y-4">
          {publicationWindow?.urgent && publicationWindow.start > new Date() && <Toast tone="info">Publicação urgente: a janela de recrutamento é reduzida e encerra no início da operação.</Toast>}
          <fieldset disabled={loading || !reviewsReady} className="min-w-0 space-y-4">
          <div>
            <label htmlFor="operation-role" className="mb-1 block text-sm font-medium text-gray-700">Função</label>
            <Select id="operation-role" required value={role} onChange={(event) => setRole(event.target.value)} className="w-full">
              <option value="">Selecione uma função</option>
              {commonSpecialties.filter((specialty) => specialty !== 'Eventos').map((specialty) => <option key={specialty} value={specialty}>{specialty}</option>)}
            </Select>
          </div>

          <fieldset className="space-y-3 rounded-xl border border-gray-200 p-4">
            <legend className="px-1 font-semibold text-gray-900">Quando?</legend>
            <div>
              <label htmlFor="operation-date" className="mb-1 block text-sm font-medium text-gray-700">Data</label>
              <TextInput id="operation-date"
              type="date"
              required
              value={jobDate}
              onChange={(e) => setJobDate(e.target.value)}
              className="w-full"
              />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-gray-700">Horário</p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <TextInput id="operation-start-time"
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full"
                aria-label="Horário de início"
                />
                <span className="text-sm text-gray-500">até</span>
                <TextInput id="operation-end-time"
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full"
                aria-label="Horário de fim"
                />
              </div>
            </div>
          </fieldset>

          <div>
            <label htmlFor="operation-daily-rate" className="mb-1 block text-sm font-medium text-gray-700">Diária</label>
            <TextInput id="operation-daily-rate"
              type="number"
              inputMode="decimal"
              step="0.01"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="R$ 150,00"
              className="w-full"
            />
          </div>
          <div>
            <label htmlFor="operation-details" className="mb-1 block text-sm font-medium text-gray-700">Detalhes</label>
            <TextArea id="operation-details"
              rows={4}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva as atribuições, uniforme exigido e detalhes do plantão..."
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
              {loading ? 'Publicando...' : 'Publicar Operação'}
            </Button>
          </div>
          </fieldset>
        </form>
        </>}
      </Card>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}