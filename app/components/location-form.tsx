'use client';

import { useState } from 'react';
import { Badge, Button, MaskedInput, Select, TextInput, Toast } from '@/app/components/ui';
import { createClient } from '@/lib/supabase/client';
import { confirmLocation, lookupPostalCode, retryLocation, saveLocation } from '@/lib/locations/client';
import {
  brazilianStates, emptyLocationInput, formatLocationAddress, locationStatusLabel, postalCodeDigits,
  validateLocationInput, type CatalogLocation, type LocationInput,
} from '@/lib/work-locations';

export default function LocationForm({ location, temporaryUntil, allowTemporary = true, makeDefault = false, onSaved, onCancel }: {
  location?: CatalogLocation | null;
  /** When set, the "use only in this operation" option creates a temporary location valid until this date. */
  temporaryUntil?: string;
  allowTemporary?: boolean;
  makeDefault?: boolean;
  onSaved: (location: CatalogLocation) => void;
  onCancel?: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [form, setForm] = useState<LocationInput>(() => location ? {
    name: location.name, address: location.address, number: location.number, neighborhood: location.neighborhood,
    city: location.city, state: location.state, postal_code: location.postal_code,
    kind: location.kind, valid_until: location.valid_until, make_default: location.is_default,
  } : { ...emptyLocationInput, make_default: makeDefault });
  const [saved, setSaved] = useState<CatalogLocation | null>(null);
  const [busy, setBusy] = useState<'' | 'cep' | 'save' | 'device' | 'approximate' | 'retry'>('');
  const [message, setMessage] = useState<{ tone: 'error' | 'info' | 'success'; text: string } | null>(null);
  const update = (patch: Partial<LocationInput>) => setForm((current) => ({ ...current, ...patch }));

  const accept = (next: CatalogLocation, warning?: string) => {
    setSaved(next);
    onSaved(next);
    if (warning) setMessage({ tone: 'error', text: warning });
    else if (next.geocoding_status === 'resolved') setMessage({ tone: 'success', text: 'Local salvo e localização confirmada.' });
    else if (next.geocoding_status === 'needs_review') {
      setMessage({ tone: 'info', text: 'Encontramos a rua, mas não o número exato. Confirme a posição para liberar o check-in por GPS.' });
    } else setMessage({ tone: 'error', text: 'Não localizamos este endereço. Revise os dados ou tente novamente.' });
  };

  const fillFromPostalCode = async (value: string) => {
    update({ postal_code: value });
    if (postalCodeDigits(value).length !== 8) return;
    setBusy('cep');
    setMessage(null);
    try {
      const found = await lookupPostalCode(value);
      setForm((current) => ({
        ...current,
        address: found.address || current.address,
        neighborhood: found.neighborhood || current.neighborhood,
        city: found.city || current.city,
        state: found.state || current.state,
      }));
    } catch (error) {
      setMessage({ tone: 'info', text: error instanceof Error ? error.message : 'Preencha o endereço manualmente.' });
    } finally { setBusy(''); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setMessage(null);
    const input: LocationInput = form.kind === 'temporary' && temporaryUntil
      ? { ...form, valid_until: temporaryUntil, make_default: false } : form;
    try {
      validateLocationInput(input);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Revise os dados do local.' });
      return;
    }
    setBusy('save');
    try {
      const current = saved ?? location ?? null;
      const result = await saveLocation(input, current ? { id: current.id, revision: current.revision } : undefined);
      accept(result.location, result.geocodingError?.message);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível salvar o local.' });
    } finally { setBusy(''); }
  };

  const confirm = async (method: 'device' | 'approximate') => {
    if (!saved || busy) return;
    setBusy(method);
    setMessage(null);
    try {
      accept(await confirmLocation(supabase, saved, method));
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível confirmar a posição.' });
    } finally { setBusy(''); }
  };

  const retry = async () => {
    if (!saved || busy) return;
    setBusy('retry');
    setMessage(null);
    try {
      const result = await retryLocation(saved.id);
      accept(result.location, result.geocodingError?.message);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível localizar o endereço.' });
    } finally { setBusy(''); }
  };

  const field = 'mb-1 block text-sm font-medium text-gray-700';
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Cadastro de local operacional">
      {message && <Toast tone={message.tone}>{message.text}</Toast>}
      <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-3">
        <div>
          <label htmlFor="location-postal-code" className={field}>CEP</label>
          <MaskedInput id="location-postal-code" mask="postal-code" required value={form.postal_code}
            onValueChange={(value) => { void fillFromPostalCode(value); }} className="w-full" placeholder="00000-000" />
          {busy === 'cep' && <p className="mt-1 text-xs text-gray-500" role="status">Buscando endereço…</p>}
        </div>
        <div>
          <label htmlFor="location-street" className={field}>Rua</label>
          <TextInput id="location-street" required maxLength={300} value={form.address}
            onChange={(event) => update({ address: event.target.value })} className="w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="location-number" className={field}>Número</label>
            <TextInput id="location-number" required maxLength={30} value={form.number}
              onChange={(event) => update({ number: event.target.value })} className="w-full" />
          </div>
          <div>
            <label htmlFor="location-neighborhood" className={field}>Bairro</label>
            <TextInput id="location-neighborhood" maxLength={120} value={form.neighborhood}
              onChange={(event) => update({ neighborhood: event.target.value })} className="w-full" />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label htmlFor="location-city" className={field}>Cidade</label>
            <TextInput id="location-city" required maxLength={120} value={form.city}
              onChange={(event) => update({ city: event.target.value })} className="w-full" />
          </div>
          <div>
            <label htmlFor="location-state" className={field}>UF</label>
            <Select id="location-state" required value={form.state} onChange={(event) => update({ state: event.target.value })}>
              <option value="">UF</option>
              {brazilianStates.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <label htmlFor="location-name" className={field}>Nome do local</label>
          <TextInput id="location-name" required maxLength={160} value={form.name} placeholder="Ex.: Restaurante Centro"
            onChange={(event) => update({ name: event.target.value })} className="w-full" />
        </div>
        {allowTemporary && (temporaryUntil ? (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <TextInput type="checkbox" id="location-temporary" checked={form.kind === 'temporary'}
              onChange={(event) => update({ kind: event.target.checked ? 'temporary' : 'permanent', valid_until: null })} />
            Usar apenas nesta operação
          </label>
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <TextInput type="checkbox" id="location-temporary" checked={form.kind === 'temporary'}
                onChange={(event) => update(event.target.checked
                  ? { kind: 'temporary', make_default: false } : { kind: 'permanent', valid_until: null })} />
              Local temporário (evento ou uso pontual)
            </label>
            {form.kind === 'temporary' && <div>
              <label htmlFor="location-valid-until" className={field}>Válido até</label>
              <TextInput id="location-valid-until" type="date" required value={form.valid_until ?? ''}
                onChange={(event) => update({ valid_until: event.target.value || null })} className="w-full" />
            </div>}
          </div>
        ))}
        {form.kind === 'permanent' && !location?.is_default && <label className="flex items-center gap-2 text-sm text-gray-700">
          <TextInput type="checkbox" id="location-make-default" checked={form.make_default}
            onChange={(event) => update({ make_default: event.target.checked })} />
          Definir como endereço principal
        </label>}
        <p className="text-xs text-gray-500">Dados de localização © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline">colaboradores do OpenStreetMap</a>.</p>
        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancelar</Button>}
          <Button type="submit" variant="primary" busy={busy === 'save'}>{saved || location ? 'Salvar alterações' : 'Salvar local'}</Button>
        </div>
      </fieldset>
      {saved && <div className="space-y-2 rounded-xl border border-gray-200 p-3" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-700">{formatLocationAddress(saved)}</p>
          <Badge tone={saved.geocoding_status === 'resolved' ? 'success' : saved.geocoding_status === 'needs_review' ? 'warning' : 'danger'}>
            {locationStatusLabel(saved)}
          </Badge>
        </div>
        {saved.geocoding_status === 'needs_review' && <div className="flex flex-wrap gap-2">
          <Button variant="primary" busy={busy === 'device'} disabled={Boolean(busy)} onClick={() => { void confirm('device'); }}>
            Confirmar no local (GPS)
          </Button>
          <Button busy={busy === 'approximate'} disabled={Boolean(busy)} onClick={() => { void confirm('approximate'); }}>
            Usar localização aproximada
          </Button>
        </div>}
        {(saved.geocoding_status === 'failed' || saved.geocoding_status === 'pending') && (
          <Button busy={busy === 'retry'} disabled={Boolean(busy)} onClick={() => { void retry(); }}>Tentar localizar novamente</Button>
        )}
      </div>}
    </form>
  );
}
