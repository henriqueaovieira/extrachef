'use client';

import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { Button, Card, TextInput, Toast } from '@/app/components/ui';
import { DashboardLogo } from '@/app/components/dashboard-identity';

export type SettingsRole = 'restaurant' | 'worker';
export type VerificationStatus = 'verified' | 'pending' | 'not_started' | 'rejected' | 'unavailable';

export function SettingsPage({ children }: { children: ReactNode }) {
  return <main className="min-h-dvh bg-gray-50 px-4 py-6 pb-[calc(16rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-10 md:pb-48">
    <div className="mx-auto max-w-2xl space-y-6">{children}</div>
  </main>;
}

export function SettingsHero({ role }: { role: SettingsRole | null }) {
  return <header className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <DashboardLogo role={role ?? undefined} />
      {role === 'restaurant' ? <Link href="/restaurant/more" className="inline-flex min-h-12 items-center text-sm font-semibold text-orange-700">← Mais</Link>
        : role === 'worker' && <Link href="/worker/profile" className="inline-flex min-h-12 items-center text-sm font-semibold text-orange-700">← Perfil</Link>}
    </div>
    <div>
      <h1 className="text-2xl font-bold text-gray-950">Privacidade e Preferências</h1>
      <p className="mt-2 text-sm leading-6 text-gray-600">Controle notificações, visibilidade e segurança da sua conta.</p>
    </div>
  </header>;
}

export function SettingsSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  return <Card aria-labelledby={id} className="overflow-hidden p-0">
    <div className="border-b border-gray-100 px-5 py-4">
      <h2 id={id} className="text-lg font-semibold text-gray-950">{title}</h2>
      {description && <p className="mt-1 text-sm leading-6 text-gray-600">{description}</p>}
    </div>
    <div className="divide-y divide-gray-100 px-5">{children}</div>
  </Card>;
}

export function PreferenceSwitch({ label, description, checked, onChange, disabled }: {
  label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return <label className={`flex min-h-16 items-center gap-4 py-4 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-gray-900">{label}</span>
      {description && <span id={id} className="mt-1 block text-sm leading-5 text-gray-500">{description}</span>}
    </span>
    <TextInput type="checkbox" role="switch" aria-label={label} aria-describedby={description ? id : undefined} checked={checked}
      disabled={disabled} onChange={(event) => onChange(event.target.checked)}
      className="peer sr-only" />
    <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-gray-300 transition-colors after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-orange-700 peer-checked:after:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-orange-700" />
  </label>;
}

export function ActionItem({ href, label, description }: { href: string; label: string; description?: string }) {
  return <Link href={href} className="flex min-h-16 items-center gap-4 py-4 text-sm hover:text-orange-700">
    <span className="min-w-0 flex-1">
      <span className="block font-semibold">{label}</span>
      {description && <span className="mt-1 block leading-5 text-gray-600">{description}</span>}
    </span>
    <span aria-hidden="true" className="text-lg text-gray-400">→</span>
  </Link>;
}

export function DangerActionItem({ label, children }: { label: string; children: ReactNode }) {
  return <details>
    <summary className="ec-button ec-button--danger w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden">{label}</summary>
    <div className="mt-4">{children}</div>
  </details>;
}

export function TalentSection({ role }: { role: SettingsRole }) {
  return <SettingsSection title="Centro de Talentos" description={role === 'restaurant'
    ? 'Encontre profissionais e gerencie suas conexões.'
    : 'Mantenha seu perfil atualizado e acompanhe suas oportunidades.'}>
    {role === 'restaurant' ? <>
      <ActionItem href="/restaurant/candidates" label="Usar Centro de Talentos" description="Explore profissionais, salve favoritos e marque Interesse." />
      <ActionItem href="/restaurant/demands" label="Gerenciar convites" description="Acesse uma operação para convidar profissionais." />
    </> : <>
      <ActionItem href="/worker/profile?edit=1" label="Atualizar perfil profissional" description="Revise os dados apresentados aos restaurantes." />
      <ActionItem href="/worker/invitations" label="Ver convites para operações" />
      <ActionItem href="/worker/dashboard" label="Explorar oportunidades" />
    </>}
  </SettingsSection>;
}

export function VerificationCard({ role, status }: { role: SettingsRole; status: VerificationStatus }) {
  const verified = role === 'worker' && status === 'verified';
  const title = role === 'restaurant' ? 'Verificação do estabelecimento'
    : verified ? 'Perfil Verificado' : status === 'pending' ? 'Verificação em análise'
      : status === 'rejected' ? 'Revisão necessária' : status === 'unavailable' ? 'Status indisponível' : 'Verificação pendente';
  const description = role === 'restaurant' ? 'A verificação de identidade do estabelecimento ainda não está disponível nesta versão.'
    : verified ? 'Sua identidade foi validada por selfie.'
      : status === 'pending' ? 'Sua selfie foi enviada e está aguardando análise.'
        : status === 'rejected' ? 'Envie uma nova selfie para concluir sua verificação.'
          : status === 'unavailable' ? 'Não foi possível consultar a verificação. Confira seu perfil para mais detalhes.'
            : 'Conclua sua verificação para aumentar a confiança dos restaurantes.';
  return <SettingsSection title="Perfil Verificado">
    <div className="space-y-3 py-5">
      <p className={`font-semibold ${verified ? 'text-emerald-800' : 'text-gray-900'}`}>
        {verified && <span aria-hidden="true">✓ </span>}{title}
      </p>
      <p className="text-sm leading-6 text-gray-600">{description}</p>
      <ActionItem href={role === 'worker' ? '/worker/profile#verification' : '/restaurant/profile'}
        label={role === 'restaurant' ? 'Ver perfil do estabelecimento'
          : verified || status === 'pending' || status === 'unavailable' ? 'Ver detalhes' : 'Verificar agora'} />
    </div>
  </SettingsSection>;
}

export function SecuritySection({ children }: { children: ReactNode }) {
  return <SettingsSection title="Conta e Segurança">
    <ActionItem href="/settings/password" label="Alterar senha" />
    <ActionItem href="/privacy" label="Política de Privacidade" />
    <ActionItem href="/terms" label="Termos de Uso" />
    <div className="py-5">{children}</div>
  </SettingsSection>;
}

export function SavePreferencesBar({ saving, disabled, onSave, message, error }: {
  saving: boolean; disabled: boolean; onSave: () => void; message?: string; error?: string;
}) {
  return <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur md:bottom-0 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
    <div className="mx-auto max-w-2xl space-y-3">
      {(error || message) && <Toast tone={error ? 'error' : 'success'}>{error || message}</Toast>}
      <Button type="button" variant="primary" busy={saving} disabled={disabled || saving} onClick={onSave} className="w-full">
        {saving ? 'Salvando...' : 'Salvar alterações'}
      </Button>
    </div>
  </div>;
}
