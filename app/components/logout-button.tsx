'use client';

import { Button, Toast } from '@/app/components/ui';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { logoutCurrentDevice } from '@/lib/auth/logout';

export default function LogoutButton() {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function logout() {
    setBusy(true);
    setErrorMessage('');
    try {
      await logoutCurrentDevice(supabase);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível sair da sua conta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {errorMessage && <Toast tone="error">{errorMessage}</Toast>}
      <Button
        type="button"
        disabled={busy}
        onClick={() => void logout()}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Saindo...' : 'Sair da conta'}
      </Button>
    </div>
  );
}
