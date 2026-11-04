'use client';

import { useEffect, useState } from 'react';
import { LoadingSkeleton, Toast } from '@/app/components/ui';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import AccountRights from '@/app/components/account-rights';
import { getVerificationState } from '@/lib/profile-verification';
import {
  PreferenceSwitch, SavePreferencesBar, SecuritySection, SettingsHero,
  SettingsPage, SettingsSection, TalentSection, VerificationCard,
  type SettingsRole, type VerificationStatus,
} from '@/app/components/settings-components';

const notificationDefaults = {
  messages_enabled: true,
  applications_enabled: true,
  reviews_enabled: true,
  operations_enabled: true,
  events_enabled: true,
};
const visibilityDefaults = {
  show_city: false, show_score: false, show_reviews: false, show_experience: false,
  show_phone: false, show_address: false, show_photos: false,
};
type NotificationKey = keyof typeof notificationDefaults;
type VisibilityKey = keyof typeof visibilityDefaults;

const notificationOptions: Array<{ key: NotificationKey; worker: string; restaurant: string; description: string }> = [
  { key: 'applications_enabled', worker: 'Atualizações de candidaturas', restaurant: 'Novas candidaturas', description: 'Avisos sobre candidaturas nas operações.' },
  { key: 'messages_enabled', worker: 'Mensagens', restaurant: 'Mensagens', description: 'Avisos de novas mensagens no chat.' },
  { key: 'operations_enabled', worker: 'Convites e atualizações de operações', restaurant: 'Atualizações de operações e convites', description: 'Inclui check-in, check-out e demais avisos operacionais.' },
  { key: 'reviews_enabled', worker: 'Avaliações', restaurant: 'Avaliações', description: 'Avisos quando você receber uma avaliação.' },
  { key: 'events_enabled', worker: 'Eventos e reservas', restaurant: 'Eventos e reservas', description: 'Avisos de eventos e reservas da plataforma.' },
];
const visibilityOptions: Record<SettingsRole, Array<{ key: VisibilityKey; label: string }>> = {
  worker: [
    { key: 'show_reviews', label: 'Exibir avaliações' },
    { key: 'show_photos', label: 'Exibir fotos' },
    { key: 'show_phone', label: 'Exibir telefone' },
  ],
  restaurant: [
    { key: 'show_reviews', label: 'Exibir avaliações do estabelecimento' },
    { key: 'show_photos', label: 'Exibir fotos' },
    { key: 'show_address', label: 'Exibir endereço comercial' },
    { key: 'show_phone', label: 'Exibir telefone' },
  ],
};

function readBooleans<T extends string>(data: Record<string, unknown>, defaults: Record<T, boolean>): Record<T, boolean> {
  const result = { ...defaults };
  for (const key in defaults) {
    if (typeof data[key] !== 'boolean') throw new Error('Preferências recebidas em formato inválido.');
    result[key] = data[key];
  }
  return result;
}

export default function PrivacySettings() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<SettingsRole | null>(null);
  const [preferences, setPreferences] = useState(notificationDefaults);
  const [visibility, setVisibility] = useState(visibilityDefaults);
  const [verification, setVerification] = useState<VerificationStatus>('unavailable');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error('Entre na sua conta para ajustar suas preferências.');
        const id = authData.user.id;
        const [notificationResult, userResult, privacyResult] = await Promise.all([
          supabase.from('notification_preferences')
            .select('messages_enabled, applications_enabled, reviews_enabled, operations_enabled, events_enabled')
            .eq('user_id', id).maybeSingle(),
          supabase.from('users').select('role').eq('id', id).single(),
          supabase.from('privacy_preferences').select('*').eq('user_id', id).maybeSingle(),
        ]);
        if (!mounted) return;
        if (userResult.error || !['worker', 'restaurant'].includes(userResult.data?.role)) {
          throw new Error('Não foi possível identificar o perfil da sua conta.');
        }
        const loadedRole: SettingsRole = userResult.data.role;
        setRole(loadedRole);
        setUserId(id);
        if (notificationResult.error || privacyResult.error) {
          console.error('Falha ao carregar preferências:', notificationResult.error ?? privacyResult.error);
          throw new Error('Não foi possível carregar suas preferências. Recarregue a página para tentar novamente.');
        }
        if (notificationResult.data) setPreferences(readBooleans(notificationResult.data, notificationDefaults));
        if (privacyResult.data) setVisibility(readBooleans(privacyResult.data, visibilityDefaults));
        setReady(true);

        if (loadedRole === 'worker') {
          const result = await supabase.from('worker_profiles').select('*').eq('user_id', id).maybeSingle();
          if (!mounted) return;
          if (result.error) {
            console.error('Falha ao consultar status de verificação:', result.error);
            setVerification('unavailable');
          } else if (!result.data) {
            setVerification('not_started');
          } else {
            try {
              setVerification(getVerificationState({
                cpf: result.data.cpf ?? '', rg: result.data.rg ?? '', phone: result.data.phone ?? '',
                selfie_verification_path: result.data.selfie_verification_path,
                verification_status: result.data.verification_status,
              }));
            } catch (error) {
              console.error('Status de verificação inválido:', error);
              setVerification('unavailable');
            }
          }
        }
      } catch (error) {
        console.error('Falha ao carregar configurações:', error);
        if (mounted) setErrorMessage(error instanceof Error ? error.message : 'Não foi possível carregar suas preferências.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, [supabase]);

  const changed = () => { setMessage(''); };
  const save = async () => {
    if (!userId || !ready || saving) return;
    setSaving(true);
    setMessage('');
    setErrorMessage('');
    try {
      const updated_at = new Date().toISOString();
      const results = await Promise.all([
        supabase.from('notification_preferences').upsert({ user_id: userId, ...preferences, updated_at }, { onConflict: 'user_id' }),
        supabase.from('privacy_preferences').upsert({ user_id: userId, ...visibility, updated_at }, { onConflict: 'user_id' }),
      ]);
      if (results.some((result) => result.error)) {
        console.error('Falha ao salvar preferências:', results.map((result) => result.error));
        throw new Error('Não foi possível salvar todas as preferências. Recarregue e confira os valores.');
      }
      setMessage('Preferências atualizadas com sucesso');
      window.dispatchEvent(new CustomEvent('extrachef:preferences-updated', { detail: preferences }));
    } catch (error) {
      console.error('Falha ao salvar configurações:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível salvar suas preferências.');
    } finally { setSaving(false); }
  };

  return <SettingsPage>
    <SettingsHero role={role} />
    {errorMessage && !ready && <Toast tone="error">{errorMessage}</Toast>}
    {loading ? <LoadingSkeleton label="Carregando preferências..." /> : role && <>
      <SettingsSection title="Notificações" description="Escolha quais avisos deseja receber por Push. As notificações continuam disponíveis na plataforma.">
        {notificationOptions.map((option) => <PreferenceSwitch key={option.key} label={option[role]} description={option.description}
          checked={preferences[option.key]} disabled={!ready || saving}
          onChange={(value) => { changed(); setPreferences((current) => ({ ...current, [option.key]: value })); }} />)}
      </SettingsSection>
      <SettingsSection title="Privacidade do Perfil" description="Controle a visibilidade dos seus dados conforme as regras de acesso da plataforma. Documentos de identidade nunca são públicos.">
        {visibilityOptions[role].map((option) => <PreferenceSwitch key={option.key} label={option.label}
          checked={visibility[option.key]} disabled={!ready || saving}
          onChange={(value) => { changed(); setVisibility((current) => ({ ...current, [option.key]: value })); }} />)}
        {role === 'worker' && <details className="py-4">
          <summary className="min-h-11 cursor-pointer text-sm font-semibold text-gray-700">Mais opções de visibilidade</summary>
          {([
            { key: 'show_city', label: 'Exibir cidade' },
            { key: 'show_score', label: 'Exibir score' },
            { key: 'show_experience', label: 'Exibir experiência' },
          ] satisfies Array<{ key: VisibilityKey; label: string }>).map((option) => <PreferenceSwitch key={option.key}
            label={option.label} checked={visibility[option.key]} disabled={!ready || saving}
            onChange={(value) => { changed(); setVisibility((current) => ({ ...current, [option.key]: value })); }} />)}
        </details>}
      </SettingsSection>
      <TalentSection role={role} />
      <VerificationCard role={role} status={verification} />
      <SecuritySection><AccountRights embedded /></SecuritySection>
    </>}
    <SavePreferencesBar saving={saving} disabled={loading || !ready} onSave={() => void save()}
      message={message} error={ready ? errorMessage : undefined} />
    {role && <MobileBottomNav role={role} />}
  </SettingsPage>;
}
