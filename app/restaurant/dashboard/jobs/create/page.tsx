'use client';

import ProfessionalVerification from '@/app/components/professional-verification';

import { Button, Card, Select, TextArea, TextInput, Toast } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { loadPendingReviews, type PendingReview } from '@/lib/operations';
import { commonSpecialties } from '@/lib/specialties';
import { emptyWorkLocation, resolveWorkLocation, validCoordinates } from '@/lib/work-location';
import { recruitmentWindow } from '@/lib/demands';

const states = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

export default function CreateJobPage() {
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');
  const [jobDate, setJobDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [value, setValue] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
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

  useEffect(() => {
    let active = true;
    async function initialize() {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !auth.user) { setErrorMessage('Faça login para criar uma operação.'); return; }
      const reviews = await loadPendingReviews(supabase);
      if (!active) return;
      setPendingReviews(reviews);
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
      const location = await resolveWorkLocation({
        ...emptyWorkLocation,
        location_name: 'Local da Operação',
        address: street,
        number,
        city,
        state,
      });
      if (!validCoordinates(location.latitude, location.longitude)) {
        throw new Error('Localize o endereço da operação antes de publicar.');
      }
      const { data: savedLocation, error: locationError } = await supabase.rpc('save_geocoded_work_location', {
        p_name: location.location_name,
        p_address: location.address,
        p_number: location.number,
        p_city: location.city,
        p_state: location.state,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
      });
      if (locationError) throw new Error(locationError.message);
      if (!savedLocation || typeof savedLocation !== 'object'
        || !('id' in savedLocation) || typeof savedLocation.id !== 'string'
        || !('revision' in savedLocation) || typeof savedLocation.revision !== 'number') {
        throw new Error('O serviço não confirmou o local da operação.');
      }
      if (!('geocoding_status' in savedLocation) || savedLocation.geocoding_status !== 'resolved'
        || !('latitude' in savedLocation) || !validCoordinates(savedLocation.latitude, savedLocation.longitude)) {
        throw new Error('O serviço não confirmou as coordenadas da operação.');
      }
      const { data: demandId, error } = await supabase.rpc('create_restaurant_demand', {
        p_title: role,
        p_description: description,
        p_job_date: jobDate,
        p_start_time: startTime,
        p_end_time: endTime,
        p_value: amount,
        p_location_source: 'catalog',
        p_work_location_id: savedLocation.id,
        p_location_revision: savedLocation.revision,
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
        </section> : <form onSubmit={handleCreateJob} className="space-y-4">
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

          <fieldset className="space-y-3 rounded-xl border border-gray-200 p-4">
            <legend className="px-1 font-semibold text-gray-900">Local da Operação</legend>
            <div>
              <label htmlFor="operation-street" className="mb-1 block text-sm font-medium text-gray-700">Rua</label>
              <TextInput id="operation-street" required maxLength={300} value={street} onChange={(event) => setStreet(event.target.value)} className="w-full" />
            </div>
            <div>
              <label htmlFor="operation-number" className="mb-1 block text-sm font-medium text-gray-700">Número</label>
              <TextInput id="operation-number" required maxLength={30} value={number} onChange={(event) => setNumber(event.target.value)} className="w-full" />
            </div>
            <div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="operation-city" className="mb-1 block text-sm font-medium text-gray-700">Cidade</label>
                  <TextInput id="operation-city" required maxLength={120} value={city} onChange={(event) => setCity(event.target.value)} className="w-full" />
                </div>
                <div>
                  <label htmlFor="operation-state" className="mb-1 block text-sm font-medium text-gray-700">Estado</label>
                  <Select id="operation-state" required value={state} onChange={(event) => setState(event.target.value)} className="w-full">
                    <option value="">UF</option>
                    {states.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
                  </Select>
                </div>
              </div>
            </div>
          </fieldset>

          <p className="text-xs text-gray-500">Dados de localização © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">colaboradores do OpenStreetMap</a>.</p>
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
        </form>}
      </Card>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}