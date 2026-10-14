'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'worker' | 'restaurant'>('worker');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setErrorMessage(authError.message);
      setLoading(false);
      return;
    }

    if (authData.user) {
      const { error: profileError } = await supabase.from('users').insert([
        {
          id: authData.user.id,
          name,
          email,
          role,
          city,
          phone,
          score: 5.00,
          verified: false,
        },
      ]);

      if (profileError) {
        setErrorMessage(profileError.message);
        setLoading(false);
        return;
      }

      if (role === 'restaurant') {
        router.push('/restaurant/dashboard');
      } else {
        router.push('/worker/dashboard');
      }
      router.refresh();
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-6 pb-10 sm:py-12">
      <section className="w-full max-w-md space-y-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Criar Conta no ExtraChef</h1>
          <p className="text-sm text-gray-500">Preencha os dados abaixo para se cadastrar</p>
        </div>

        {errorMessage && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 border border-red-200">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Conta</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('worker')}
                className={`min-h-12 rounded-xl border p-3 text-sm font-semibold transition ${
                  role === 'worker'
                    ? 'border-orange-600 bg-orange-50 text-orange-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Profissional
              </button>
              <button
                type="button"
                onClick={() => setRole('restaurant')}
                className={`min-h-12 rounded-xl border p-3 text-sm font-semibold transition ${
                  role === 'restaurant'
                    ? 'border-orange-600 bg-orange-50 text-orange-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Restaurante
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo / Estabelecimento</label>
            <input
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={role === 'restaurant' ? 'Nome do Restaurante' : 'Seu Nome'}
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

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
              autoComplete="new-password"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cidade</label>
              <input
                type="text"
                autoComplete="address-level2"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ex: São Paulo"
                className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
              <input
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="min-h-12 w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 min-h-12 w-full rounded-xl bg-orange-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
          >
            {loading ? 'Cadastrando...' : 'Criar Conta'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Já tem uma conta?{' '}
          <Link href="/login" className="font-semibold text-orange-600 hover:underline">
            Faça login
          </Link>
        </p>
      </section>
    </main>
  );
}