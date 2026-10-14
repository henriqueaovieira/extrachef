'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', data.user.id)
        .single();

      if (profile?.role === 'restaurant') {
        router.push('/restaurant/dashboard');
      } else {
        router.push('/worker/dashboard');
      }
      router.refresh();
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-6 sm:py-12">
      <section className="w-full max-w-md space-y-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Entrar no ExtraChef</h1>
          <p className="text-sm text-gray-500">Acesse sua conta para continuar</p>
        </div>

        {errorMessage && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 border border-red-200">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="min-h-12 w-full rounded-xl bg-orange-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Não tem uma conta?{' '}
          <Link href="/register" className="font-semibold text-orange-600 hover:underline">
            Cadastre-se
          </Link>
        </p>
      </section>
    </main>
  );
}