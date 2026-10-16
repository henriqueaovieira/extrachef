  'use client';

  import { useState } from 'react';
  import { Button, MaskedInput, TextInput, Toast } from '@/app/components/ui';
  import { resolveWorkLocation, type WorkLocation } from '@/lib/work-location';

  export default function WorkLocationFields({ value, onChange, onBusyChange, prefix, disabled = false }: {
    value: WorkLocation; onChange: (value: WorkLocation) => void; prefix: string; disabled?: boolean;
    onBusyChange?: (busy: boolean) => void;
  }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const edit = (field: keyof WorkLocation, text: string) => {
      onChange({ ...value, [field]: text, latitude: null, longitude: null });
      setError('');
    };
    return (
      <fieldset disabled={disabled || busy} className="space-y-3 rounded-xl border border-gray-200 p-4">
        <legend className="px-1 font-semibold">{prefix === 'event' ? 'Local do Evento' : 'Local do Trabalho'}</legend>
        <p className="text-sm text-gray-600">Endereço operacional, independente do cadastro da empresa. As coordenadas serão geradas ao salvar.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['location_name', 'Nome do local', false, 'Ex.: Hotel Fazenda'],
            ['address', 'Endereço / rodovia e km', true, 'Ex.: Rua das Flores'],
            ['number', 'Número (opcional)', false, '120 ou s/n'],
            ['neighborhood', 'Bairro (opcional)', false, 'Centro'],
            ['city', 'Cidade', true, 'Piracicaba'],
            ['state', 'UF', true, 'SP'],
          ] as const).map(([field, label, required, placeholder]) => (
            <div key={field}>
              <label htmlFor={`${prefix}-${field}`} className="mb-1 block text-sm font-semibold">{label}</label>
              <TextInput id={`${prefix}-${field}`} value={value[field]} required={required} placeholder={placeholder}
                maxLength={field === 'state' ? 2 : field === 'number' ? 30 : field === 'address' ? 300 : field === 'location_name' ? 160 : 120}
                autoComplete={field === 'city' ? 'address-level2' : field === 'state' ? 'address-level1' : field === 'address' ? 'street-address' : 'off'}
                onChange={(event) => edit(field, field === 'state' ? event.target.value.toUpperCase() : event.target.value)}
                className="w-full" />
            </div>
          ))}
          <div>
            <label htmlFor={`${prefix}-postal`} className="mb-1 block text-sm font-semibold">CEP</label>
            <MaskedInput id={`${prefix}-postal`} mask="postal-code" value={value.postal_code} required
              onValueChange={(text) => edit('postal_code', text)} autoComplete="postal-code" className="w-full" />
          </div>
        </div>
        <Button busy={busy} disabled={disabled || busy} onClick={() => {
          setBusy(true); onBusyChange?.(true); setError('');
          void resolveWorkLocation(value).then(onChange).catch((failure: unknown) => {
            setError(failure instanceof Error ? failure.message : 'Não foi possível localizar o endereço.');
          }).finally(() => { setBusy(false); onBusyChange?.(false); });
        }}>Conferir localização</Button>
        {value.latitude !== null && value.longitude !== null && (
          <p role="status" className="text-sm text-emerald-800">Coordenadas do endereço: {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}. Confira se correspondem ao local informado.</p>
        )}
        {error && <Toast tone="error">{error}</Toast>}
      </fieldset>
    );
  }
