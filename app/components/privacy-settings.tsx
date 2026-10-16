'use client';

import { Button, LoadingSkeleton, TextInput, Toast } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import AccountRights from '@/app/components/account-rights';
import DevicePermissions from '@/app/components/device-permissions';

interface Preferences {
  messages_enabled: boolean;
  applications_enabled: boolean;
  reviews_enabled: boolean;
  operations_enabled: boolean;
  events_enabled: boolean;
}

const defaults: Preferences = {
  messages_enabled: true,
  applications_enabled: true,
  reviews_enabled: true,
  operations_enabled: true,
  events_enabled: true,
};

const visibilityDefaults = { show_city: false, show_score: false, show_reviews: false, show_experience: false, show_phone: false, show_address: false, show_photos: false };
const visibilityLabels: Record<keyof typeof visibilityDefaults, string> = {
  show_city: 'Exibir cidade', show_score: 'Exibir score', show_reviews: 'Exibir avaliações',
  show_experience: 'Exibir experiência', show_phone: 'Exibir telefone', show_address: 'Exibir endereço', show_photos: 'Exibir fotos',
};

const options: Array<{ key: keyof Preferences; label: string; description: string }> = [
  { key: 'messages_enabled', label: 'Mensagens', description: 'Avisos de novas mensagens no chat.' },
  { key: 'applications_enabled', label: 'Candidaturas', description: 'Aprovações e atualizações de candidaturas.' },
  { key: 'reviews_enabled', label: 'Avaliações', description: 'Avisos quando você receber uma avaliação.' },
  { key: 'operations_enabled', label: 'Operacionais', description: 'Check-in, check-out e atualizações da diária.' },
  { key: 'events_enabled', label: 'Eventos', description: 'Avisos de eventos e atividades futuras.' },
];

export default function PrivacySettings() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'restaurant' | 'worker' | null>(null);
  const [preferences, setPreferences] = useState(defaults);
  const [visibility, setVisibility] = useState(visibilityDefaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (authError || !authData.user) {
        setErrorMessage('Entre na sua conta para ajustar suas preferências.');
        setLoading(false);
        return;
      }
      setUserId(authData.user.id);
      const [{ data: preferenceData, error: preferenceError }, { data: userData }] = await Promise.all([
        supabase.from('notification_preferences')
          .select('messages_enabled, applications_enabled, reviews_enabled, operations_enabled, events_enabled')
          .eq('user_id', authData.user.id)
          .maybeSingle(),
        supabase.from('users').select('role').eq('id', authData.user.id).maybeSingle(),
      ]);
      if (!mounted) return;
      if (preferenceError) setErrorMessage('Não foi possível carregar as preferências. Aplique a migration de notificações.');
      else if (preferenceData) setPreferences(preferenceData as Preferences);
      if (userData?.role === 'worker' || userData?.role === 'restaurant') setRole(userData.role);
      const privacyResult = await supabase.from('privacy_preferences').select('*').eq('user_id', authData.user.id).maybeSingle();
      if (!mounted) return;
      if (privacyResult.error) setErrorMessage('Não foi possível carregar a visibilidade. Aplique a migration de privacidade.');
      else if (privacyResult.data) setVisibility(Object.fromEntries(Object.keys(visibilityDefaults).map((key) => [key, privacyResult.data[key] === true])) as typeof visibilityDefaults);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, [supabase]);

  const save = async () => {
    if (!userId || saving) return;
    setSaving(true);
    setMessage('');
    setErrorMessage('');
    const { error } = await supabase.from('notification_preferences').upsert({
      user_id: userId,
      ...preferences,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    const visibilityResult = await supabase.from('privacy_preferences').upsert({ user_id: userId, ...visibility, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error || visibilityResult.error) setErrorMessage('Não foi possível salvar todas as preferências. Recarregue e confira os valores.');
    else {
      setMessage('Preferências salvas.');
      window.dispatchEvent(new CustomEvent('extrachef:preferences-updated', { detail: preferences }));
    }
    setSaving(false);
  };

  return (
    <main className="min-h-dvh bg-gray-50 px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-2xl space-y-5">
        <header>
          <p className="text-sm font-semibold text-orange-700">ExtraChef</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">Privacidade e notificações</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">Escolha quais avisos deseja receber. A permissão do navegador para Push é configurada separadamente no Perfil.</p>
        </header>

        {loading ? (
          <LoadingSkeleton label="Carregando preferências..." />
        ) : (
          <section className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white px-4 shadow-sm">
            {options.map((option) => (
              <label key={option.key} className="flex min-h-20 cursor-pointer items-center gap-4 py-4">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900">{option.label}</span>
                  <span className="mt-1 block text-sm text-gray-500">{option.description}</span>
                </span>
                <TextInput
                  type="checkbox"
                  checked={preferences[option.key]}
                  onChange={(event) => setPreferences((current) => ({ ...current, [option.key]: event.target.checked }))}
                  className="shrink-0"
                  disabled={!userId}
                />
              </label>
            ))}
          </section>
        )}

        {errorMessage && <Toast tone="error">{errorMessage}</Toast>}
        {userId && <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-gray-900">Visibilidade do perfil</h2>
          <p className="mt-1 text-sm text-gray-600">Documentos de identidade nunca são públicos. Outros dados são liberados somente pelas regras de acesso do banco.</p>
          {(Object.keys(visibilityLabels) as Array<keyof typeof visibilityDefaults>).filter((key) => role === 'worker'
            ? !['show_address'].includes(key) : !['show_city', 'show_score', 'show_experience'].includes(key)).map((key) => (
            <label key={key} className="flex min-h-14 items-center justify-between gap-3 border-b border-gray-100 py-3 text-sm font-medium">
              {visibilityLabels[key]}<TextInput type="checkbox" checked={visibility[key]} onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))} className="size-5" />
            </label>
          ))}
        </section>}
        {message && <p role="status" className="text-sm font-medium text-emerald-800">{message}</p>}
        <Button variant="primary" type="button" onClick={() => void save()} disabled={saving || loading || !userId} className="w-full px-4">
          {saving ? 'Salvando...' : 'Salvar preferências'}
        </Button>
        {userId && <><DevicePermissions /><AccountRights /></>}
      </section>
      {role && <MobileBottomNav role={role} />}
    </main>
  );
}
