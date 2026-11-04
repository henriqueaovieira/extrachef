'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button, TextInput, PasswordInput } from '@/app/components/ui';
import { DangerActionItem } from '@/app/components/settings-components';

export default function AccountRights({ embedded = false }: { embedded?: boolean }) {
  const [supabase] = useState(() => createClient());
  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const headers = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Entre novamente para continuar.');
    return { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' };
  };

  const exportData = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/account/export', { headers: await headers(), cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível exportar seus dados.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'extrachef-meus-dados.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage('Download iniciado. Guarde o arquivo em local seguro: ele contém dados pessoais.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha na exportação.'); }
    finally { setBusy(false); }
  };

  const deleteAccount = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST', headers: await headers(), body: JSON.stringify({ confirmation, password }),
      });
      setPassword('');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'A exclusão não foi concluída.');
      await supabase.auth.signOut({ scope: 'local' });
      for (const storage of [localStorage, sessionStorage]) {
        Object.keys(storage).filter((key) => key.startsWith('extrachef:')).forEach((key) => storage.removeItem(key));
      }
      const registration = await navigator.serviceWorker?.getRegistration('/');
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      window.location.replace('/login');
    } catch (error) { setPassword(''); setMessage(error instanceof Error ? error.message : 'Falha na exclusão.'); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Seus dados" className={embedded ? 'space-y-5' : 'space-y-6 border-t border-gray-200 pt-6'}>
      {!embedded && <div className="flex flex-wrap gap-4 text-sm font-semibold text-orange-700">
        <Link href="/privacy" className="inline-flex min-h-12 items-center underline">Política de privacidade</Link>
        <Link href="/terms" className="inline-flex min-h-12 items-center underline">Termos de uso</Link>
      </div>}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5 shrink-0"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10 9-5M3 8l9 5v8M7.5 5.5l9 5" /></svg>
          Seus dados
        </h3>
        <p className="text-sm leading-6 text-gray-600">Solicite uma cópia dos dados vinculados à sua conta.</p>
        <Button type="button" disabled={busy} onClick={() => void exportData()} className="w-full">Exportar dados</Button>
      </div>
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold text-red-700">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0"><path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01" /></svg>
          Zona de Perigo
        </h3>
        <p className="text-sm leading-6 text-gray-600">A exclusão da conta é permanente e não poderá ser desfeita.</p>
        <p className="text-sm leading-6 text-gray-600">Alguns registros poderão ser mantidos conforme exigências legais.</p>
        <DangerActionItem label="Excluir minha conta">
          <p className="mb-4 text-sm leading-6 text-gray-600">Esta ação remove os arquivos do perfil, anonimiza sua conta e desativa o acesso. Diárias ativas precisam ser resolvidas antes. Históricos de outras pessoas não são apagados por cascata.</p>
          <form onSubmit={(event) => void deleteAccount(event)} className="space-y-3">
            <label className="block text-sm font-medium">Digite EXCLUIR<TextInput required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 p-3 text-base" /></label>
            <label className="block text-sm font-medium">Senha atual<PasswordInput required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="mt-1 min-h-12 w-full rounded-lg border border-gray-300 p-3 text-base" /></label>
            <Button type="submit" disabled={busy || confirmation !== 'EXCLUIR' || !password} className="min-h-12 w-full rounded-lg bg-red-700 px-4 font-semibold text-white disabled:opacity-50">{busy ? 'Processando...' : 'Excluir minha conta definitivamente'}</Button>
          </form>
        </DangerActionItem>
      </div>
      {message && <p role="status" className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">{message}</p>}
    </section>
  );
}