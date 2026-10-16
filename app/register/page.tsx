'use client';
import { Button, Card, LoadingSkeleton, MaskedInput, PasswordInput, TextInput, Toast } from '@/app/components/ui';
import { Suspense, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { sanitizeRedirect } from '@/lib/auth/routes';
import { getAccountRole } from '@/lib/auth/account';

export default function RegisterPage() {
  return <Suspense fallback={<LoadingSkeleton label="Carregando..." />}><RegisterForm /></Suspense>;
}

function RegisterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'worker' | 'restaurant'>('worker');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [supabase] = useState(() => createClient());
  const params = useSearchParams();
  const requestedRedirect = params.get('redirect');
  const loginLink = requestedRedirect
    ? `/login?${new URLSearchParams({ redirect: requestedRedirect })}`
    : '/login';

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedLegal) {
      setErrorMessage('Leia e aceite os Termos de Uso e a Política de Privacidade para continuar.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const callback = new URL('/auth/callback', window.location.origin);
      callback.searchParams.set('redirect', sanitizeRedirect(requestedRedirect, role));
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: callback.toString(),
          data: {
            name: name.trim(), role, city: city.trim(), phone: phone.trim(),
            accepted_terms: true, accepted_privacy_policy: true, legal_version: '2026-10-15',
          },
        },
      });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      if (!data.session || !data.user) {
        setSuccessMessage('Confira seu e-mail para confirmar o cadastro. Abra o link neste navegador para continuar.');
        return;
      }
      const accountRole = await getAccountRole(supabase, data.user.id, true);
      window.location.replace(sanitizeRedirect(requestedRedirect, accountRole));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível cadastrar sua conta. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-6 pb-10 sm:py-12">
      <Card className="w-full max-w-md space-y-6 sm:p-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Criar Conta no ExtraChef</h1>
          <p className="text-sm text-gray-500">Preencha os dados abaixo para se cadastrar</p>
        </div>

        {errorMessage && (
          <Toast tone="error">{errorMessage}</Toast>
        )}
        {successMessage && <Toast tone="success">{successMessage}</Toast>}

        {!successMessage && <form onSubmit={handleRegister} className="space-y-4">
          <label className="flex min-h-12 items-start gap-3 text-sm leading-6 text-gray-700">
            <TextInput type="checkbox" required checked={acceptedLegal} onChange={(event) => setAcceptedLegal(event.target.checked)} className="mt-1 size-5 shrink-0" />
            <span>Li e aceito os <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Termos de Uso</Link> e a <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold underline">Política de Privacidade</Link>.</span>
          </label>
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-1">Tipo de Conta</legend>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                aria-pressed={role === 'worker'}
                onClick={() => setRole('worker')}
                className={`min-h-12 rounded-xl border p-3 text-sm font-semibold transition ${
                  role === 'worker'
                    ? 'border-orange-600 bg-orange-50 text-orange-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Profissional
              </Button>
              <Button
                type="button"
                aria-pressed={role === 'restaurant'}
                onClick={() => setRole('restaurant')}
                className={`min-h-12 rounded-xl border p-3 text-sm font-semibold transition ${
                  role === 'restaurant'
                    ? 'border-orange-600 bg-orange-50 text-orange-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Restaurante
              </Button>
            </div>
          </fieldset>

          <div>
            <label htmlFor="field-register-page-tsx-1" className="block text-sm font-medium text-gray-700 mb-1">Nome Completo / Estabelecimento</label>
            <TextInput id="field-register-page-tsx-1"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={role === 'restaurant' ? 'Nome do Restaurante' : 'Seu Nome'}
              className="w-full"
            />
          </div>

          <div>
            <label htmlFor="field-register-page-tsx-2" className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <TextInput id="field-register-page-tsx-2"
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
            <label htmlFor="field-register-page-tsx-3" className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <PasswordInput id="field-register-page-tsx-3"
              autoComplete="new-password"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="field-register-page-tsx-4" className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
              <TextInput id="field-register-page-tsx-4"
                type="text"
                autoComplete="address-level2"
                required
                minLength={2}
                maxLength={120}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ex: São Paulo"
                className="w-full"
              />
            </div>
            <div>
              <label htmlFor="field-register-page-tsx-5" className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <MaskedInput id="field-register-page-tsx-5"
                mask="phone"
                autoComplete="tel"
                inputMode="tel"
                maxLength={30}
                value={phone}
                onValueChange={setPhone}
                placeholder="(11) 99999-9999"
                className="w-full"
              />
            </div>
          </div>

          <Button variant="primary"
            type="submit"
            disabled={loading}
            busy={loading}
            className="mt-2 w-full px-4 py-3 text-base shadow-sm"
          >
            {loading ? 'Cadastrando...' : 'Criar Conta'}
          </Button>
        </form>}

        <p className="text-center text-sm text-gray-500">
          Já tem uma conta?{' '}
          <Link href={loginLink} className="font-semibold text-orange-600 hover:underline">
            Faça login
          </Link>
        </p>
      </Card>
    </main>
  );
}