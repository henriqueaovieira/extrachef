'use client';
import { Button, Card, PasswordInput, Toast } from '@/app/components/ui';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MIN_PASSWORD_LENGTH, updatePasswordAndSignOut } from '@/lib/auth/password-recovery';

export default function ResetPasswordPage() {
  const [supabase] = useState(() => createClient());
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    try {
      window.location.replace(await updatePasswordAndSignOut(supabase.auth, password, confirmation));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível redefinir sua senha. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-6 sm:py-12">
      <Card className="w-full max-w-md space-y-6 sm:p-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Redefinir senha</h1>
          <p className="text-sm text-gray-500">Crie uma nova senha para acessar o ExtraChef.</p>
        </div>

        {errorMessage && <Toast tone="error">{errorMessage}</Toast>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="field-reset-password" className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <PasswordInput id="field-reset-password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <div>
            <label htmlFor="field-reset-password-confirmation" className="block text-sm font-medium text-gray-700 mb-1">Confirmar nova senha</label>
            <PasswordInput id="field-reset-password-confirmation"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button variant="primary" type="submit" disabled={loading} busy={loading} className="w-full px-4 py-3 text-base shadow-sm">
            {loading ? 'Salvando...' : 'Salvar nova senha'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
