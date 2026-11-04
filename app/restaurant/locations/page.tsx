'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import LocationForm from '@/app/components/location-form';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { Badge, Button, Card, EmptyState, LoadingSkeleton, Toast } from '@/app/components/ui';
import { createClient } from '@/lib/supabase/client';
import { confirmLocation, loadWorkLocations, manageLocation, retryLocation } from '@/lib/locations/client';
import { formatLocationAddress, locationStatusLabel, type CatalogLocation } from '@/lib/work-locations';

export default function RestaurantLocationsPage() {
  const [supabase] = useState(() => createClient());
  const [locations, setLocations] = useState<CatalogLocation[] | null>(null);
  const [editing, setEditing] = useState<CatalogLocation | 'new' | null>(null);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((current) => current + 1);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data: auth, error } = await supabase.auth.getUser();
      if (error || !auth.user) throw new Error('Faça login para gerenciar locais.');
      const catalog = await loadWorkLocations(supabase, auth.user.id);
      if (active) setLocations(catalog);
    }
    void load().catch((error) => {
      if (active) setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível carregar os locais.' });
    });
    return () => { active = false; };
  }, [supabase, version]);

  const run = async (location: CatalogLocation, task: () => Promise<unknown>, success: string) => {
    if (busyId) return;
    setBusyId(location.id);
    setMessage(null);
    try {
      await task();
      setMessage({ tone: 'success', text: success });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível atualizar o local.' });
    } finally {
      setBusyId('');
      reload();
    }
  };

  const active = (locations ?? []).filter((location) => !location.archived_at);
  const archived = (locations ?? []).filter((location) => location.archived_at);
  const hasPrimary = active.some((location) => location.is_default);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:py-12 md:pb-10">
      <Card className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Locais operacionais</h1>
            <p className="mt-1 text-sm text-gray-500">Cadastre os endereços uma única vez. As operações usam o local escolhido e o check-in por GPS.</p>
          </div>
          <Link href="/restaurant/demands" className="inline-flex min-h-12 items-center text-sm font-semibold text-gray-600 hover:text-orange-600">← Voltar</Link>
        </div>

        {message && <Toast tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Toast>}
        {locations && !hasPrimary && editing === null && (
          <Toast tone="info">Cadastre o endereço operacional principal para publicar operações sem digitar o endereço.</Toast>
        )}

        {editing !== null ? <section className="space-y-3">
          <h2 className="text-lg font-semibold">{editing === 'new' ? 'Novo local' : `Editar ${editing.name}`}</h2>
          <LocationForm key={editing === 'new' ? 'new' : editing.id} location={editing === 'new' ? null : editing}
            makeDefault={!hasPrimary}
            onSaved={reload}
            onCancel={() => setEditing(null)} />
          <Button className="w-full" onClick={() => setEditing(null)}>Concluir</Button>
        </section> : <Button variant="primary" className="w-full" onClick={() => setEditing('new')}>+ Novo local</Button>}

        {locations === null ? <LoadingSkeleton label="Carregando locais" /> : active.length === 0 ? (
          <EmptyState title="Nenhum local cadastrado" description="Cadastre o endereço do restaurante com CEP para começar a publicar operações." />
        ) : <ul className="space-y-3" aria-label="Locais ativos">
          {active.map((location) => (
            <li key={location.id}>
              <Card as="article" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-gray-900">{location.name}</h2>
                  {location.is_default && <Badge tone="success">Principal</Badge>}
                  {location.kind === 'temporary' && <Badge>Temporário até {location.valid_until?.split('-').reverse().join('/')}</Badge>}
                  <Badge tone={location.geocoding_status === 'resolved' ? 'success' : location.geocoding_status === 'needs_review' ? 'warning' : 'danger'}>
                    {locationStatusLabel(location)}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600">{formatLocationAddress(location)}</p>
                <div className="flex flex-wrap gap-2">
                  {location.geocoding_status === 'needs_review' && <>
                    <Button variant="primary" disabled={Boolean(busyId)} busy={busyId === location.id}
                      onClick={() => { void run(location, () => confirmLocation(supabase, location, 'device'), 'Posição confirmada pelo GPS.'); }}>
                      Confirmar no local (GPS)
                    </Button>
                    <Button disabled={Boolean(busyId)}
                      onClick={() => { void run(location, () => confirmLocation(supabase, location, 'approximate'), 'Localização aproximada confirmada.'); }}>
                      Usar localização aproximada
                    </Button>
                  </>}
                  {(location.geocoding_status === 'failed' || location.geocoding_status === 'pending') && location.postal_code && (
                    <Button disabled={Boolean(busyId)} onClick={() => { void run(location, async () => {
                      const result = await retryLocation(location.id);
                      if (result.geocodingError) throw new Error(result.geocodingError.message);
                    }, 'Localização atualizada.'); }}>Tentar localizar novamente</Button>
                  )}
                  <Button disabled={Boolean(busyId)} onClick={() => setEditing(location)}>
                    {location.postal_code ? 'Editar' : 'Completar endereço (CEP)'}
                  </Button>
                  {!location.is_default && location.kind === 'permanent' && (
                    <Button disabled={Boolean(busyId)} onClick={() => { void run(location, () => manageLocation(supabase, location, 'set_default'), 'Endereço principal atualizado.'); }}>
                      Tornar principal
                    </Button>
                  )}
                  <Button variant="ghost" disabled={Boolean(busyId)} onClick={() => { void run(location, () => manageLocation(supabase, location, 'archive'), 'Local arquivado.'); }}>
                    Arquivar
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>}

        {archived.length > 0 && <section className="space-y-3">
          <Button variant="ghost" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)}>
            {showArchived ? 'Ocultar arquivados' : `Ver arquivados (${archived.length})`}
          </Button>
          {showArchived && <ul className="space-y-2" aria-label="Locais arquivados">
            {archived.map((location) => (
              <li key={location.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 p-3">
                <span className="text-sm text-gray-600">{location.name} · {formatLocationAddress(location)}</span>
                <Button disabled={Boolean(busyId)} onClick={() => { void run(location, () => manageLocation(supabase, location, 'restore'), 'Local restaurado.'); }}>
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>}
        </section>}
      </Card>
      <MobileBottomNav role="restaurant" />
    </main>
  );
}
