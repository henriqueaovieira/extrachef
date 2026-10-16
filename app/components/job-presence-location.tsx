'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LoadingSkeleton, Toast } from '@/app/components/ui';

interface PresenceLocation {
  location_name: string | null;
  work_address: string | null;
  work_number: string | null;
  work_city: string | null;
  work_state: string | null;
  work_latitude: number | null;
  geofence_radius_m: number;
}

export default function JobPresenceLocation({ jobId }: { jobId: string }) {
  const [supabase] = useState(() => createClient());
  const [location, setLocation] = useState<PresenceLocation | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from('jobs')
        .select('location_name, work_address, work_number, work_city, work_state, work_latitude, geofence_radius_m')
        .eq('id', jobId).single();
      if (!active) return;
      if (error) setError('Não foi possível consultar o local da vaga. Recarregue a página.');
      else { setError(''); setLocation(data); }
    }
    void load().catch(() => {
      if (active) setError('Não foi possível consultar o local da vaga. Recarregue a página.');
    });
    return () => { active = false; };
  }, [jobId, supabase]);
  if (error) return <Toast tone="error">{error}</Toast>;
  if (!location) return <LoadingSkeleton label="Carregando local do trabalho" />;
  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="font-semibold text-gray-900">Local do trabalho</h3>
      {location.work_address ? (
        <p className="text-sm text-gray-700">{location.location_name} · {location.work_address} {location.work_number} · {location.work_city}/{location.work_state}</p>
      ) : <p className="text-sm text-gray-700">Vaga antiga: endereço não informado.</p>}
      {location.work_latitude === null ? (
        <Toast tone="error">Localização não cadastrada. Contate o restaurante para corrigir o local antes de registrar presença.</Toast>
      ) : <p className="text-sm text-gray-700">Check-in e check-out exigem GPS a até {location.geofence_radius_m} metros do local da vaga, não do endereço da empresa.</p>}
    </section>
  );
}
