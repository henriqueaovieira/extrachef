'use client';
import { Button, Card, LoadingSkeleton, PasswordInput, TextInput, Toast } from '@/app/components/ui';
import { Suspense, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authMessages, sanitizeRedirect } from '@/lib/auth/routes';
import { getAccountRole } from '@/lib/auth/account';
import { isRecoveryReason, requestPasswordRecovery } from '@/lib/auth/password-recovery';

export default function LoginPage() {
  return <Suspense fallback={<LoadingSkeleton label="Carregando..." />}><LoginForm /></Suspense>;
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const params = useSearchParams();
  const reason = params.get('reason');
  const recoveryReason = isRecoveryReason(reason);
  const [recovering, setRecovering] = useState(recoveryReason);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [supabase] = useState(() => createClient());
  const requestedRedirect = params.get('redirect');
  const reasonMessage = authMessages[reason ?? ''];
  const loginReasonMessage = recoveryReason ? '' : reasonMessage;
  const registerHref = requestedRedirect
    ? `/register?${new URLSearchParams({ redirect: requestedRedirect })}`
    : '/register';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      if (!data.user) throw new Error('Não foi possível iniciar sua sessão. Tente novamente.');
      const role = await getAccountRole(supabase, data.user.id, true);
      window.location.replace(sanitizeRedirect(requestedRedirect, role));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const openRecovery = () => {
    setErrorMessage('');
    setRecoveryMessage('');
    setRecovering(true);
  };

  const closeRecovery = () => {
    setErrorMessage('');
    setRecoveryMessage('');
    setRecovering(false);
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');
    setRecoveryMessage('');
    try {
      setRecoveryMessage(await requestPasswordRecovery(supabase.auth, email, window.location.origin));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível enviar o e-mail. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (recovering) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-6 sm:py-12">
        <Card className="w-full max-w-md space-y-6 sm:p-8">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-gray-900">Recuperar senha</h1>
            <p className="text-sm text-gray-500">Informe o e-mail da sua conta para receber o link de redefinição.</p>
          </div>

          {recoveryReason && reasonMessage && !recoveryMessage && !errorMessage && (
            <p role="status" className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800">{reasonMessage}</p>
          )}
          {errorMessage && <Toast tone="error">{errorMessage}</Toast>}
          {recoveryMessage && <Toast tone="success">{recoveryMessage}</Toast>}

          <form onSubmit={handleRecovery} className="space-y-4">
            <div>
              <label htmlFor="field-login-recovery-email" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <TextInput id="field-login-recovery-email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full"
              />
            </div>
            <Button variant="primary" type="submit" disabled={loading} busy={loading} className="w-full px-4 py-3 text-base shadow-sm">
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            <Button variant="ghost" onClick={closeRecovery} className="min-h-9 px-0 text-sm font-semibold text-orange-600 hover:underline">
              ← Voltar ao login
            </Button>
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-6 sm:py-12">
      <Card className="w-full max-w-md space-y-6 sm:p-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Entrar no ExtraChef</h1>
          <p className="text-sm text-gray-500">Acesse sua conta para continuar</p>
        </div>

        {loginReasonMessage && <p role="status" className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800">{loginReasonMessage}</p>}
        {params.get('warning') === 'device_cleanup_failed' && (
          <p role="alert" className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800">
            Sua conta foi desconectada, mas a limpeza do dispositivo não terminou. Revise as notificações nas configurações do navegador.
          </p>
        )}
        {errorMessage && (
          <Toast tone="error">{errorMessage}</Toast>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="field-login-page-tsx-1" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <TextInput id="field-login-page-tsx-1"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="field-login-page-tsx-2" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <PasswordInput id="field-login-page-tsx-2"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            <div className="mt-1 text-right">
              <Button variant="ghost" onClick={openRecovery} className="min-h-9 px-0 text-sm font-semibold text-orange-600 hover:underline">
                Esqueceu sua senha?
              </Button>
            </div>
          </div>

          <Button variant="primary"
            type="submit"
            disabled={loading}
            busy={loading}
            className="w-full px-4 py-3 text-base shadow-sm"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Não tem uma conta?{' '}
          <Link href={registerHref} className="font-semibold text-orange-600 hover:underline">
            Cadastre-se
          </Link>
        </p>
      </Card>
    </main>
  );
}