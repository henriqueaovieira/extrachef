'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { getDeviceCoordinates } from '@/lib/geolocation';

export default function CreateJobPage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [jobDate, setJobDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [value, setValue] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const router = useRouter();
  const supabase = createClient();

  const captureLocation = async () => {
    setLocating(true);
    setErrorMessage('');
    try {
      setLocation(await getDeviceCoordinates());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível obter a localização.');
    } finally {
      setLocating(false);
    }
  };

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) {
      setErrorMessage('Registre a localização do estabelecimento para permitir check-in seguro.');
      return;
    }
    setLoading(true);
    setErrorMessage('');

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      setErrorMessage('Sessão expirada. Faça login novamente.');
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('jobs').insert([
      {
        restaurant_id: authData.user.id,
        title,
        description,
        job_date: jobDate,
        start_time: startTime,
        end_time: endTime,
        value: parseFloat(value),
        latitude: location.latitude,
        longitude: location.longitude,
        status: 'open',
      },
    ]);

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    router.push('/restaurant/dashboard');
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:py-12 md:pb-10">
      <section className="mx-auto max-w-xl space-y-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Criar Nova Vaga</h1>
            <p className="text-sm text-gray-500 mt-1">Preencha os dados do plantão temporário.</p>
          </div>
          <Link
            href="/restaurant/dashboard"
            className="inline-flex min-h-12 items-center text-sm font-semibold text-gray-600 hover:text-orange-600"
          >
            ← Voltar
          </Link>
        </div>

        {errorMessage && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 border border-red-200">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleCreateJob} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cargo</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Cozinheiro(a), Garçom, Auxiliar"
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
            <textarea
              rows={4}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva as atribuições, uniforme exigido e detalhes do plantão..."
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Data</label>
            <input
              type="date"
              required
              value={jobDate}
              onChange={(e) => setJobDate(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">Localização do serviço</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">Necessária para validar presença em um raio de 300 metros.</p>
            </div>
            <button
              type="button"
              onClick={() => void captureLocation()}
              disabled={locating || loading}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 disabled:opacity-50"
            >
              {locating ? 'Obtendo localização...' : location ? 'Atualizar localização' : 'Usar localização do dispositivo'}
            </button>
            {location && <p role="status" className="text-xs text-emerald-800">Localização registrada, precisão aproximada de {Math.round(location.accuracy)} m.</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Horário Inicial</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Horário Final</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Valor da Diária (R$)</label>
            <input
              type="number"
              step="0.01"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ex: 180.00"
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t">
            <Link
              href="/restaurant/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
            >
              {loading ? 'Publicando...' : 'Publicar Vaga'}
            </button>
          </div>
        </form>
      </section>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}