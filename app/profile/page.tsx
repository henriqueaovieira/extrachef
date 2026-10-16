'use client';

import { LoadingSkeleton, Toast } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import LogoutButton from '@/app/components/logout-button';

interface UserProfile {
  name: string;
  city: string | null;
  score: number | null;
  role: 'restaurant' | 'worker';
}

export default function ProfilePage() {
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (isMounted) {
          setErrorMessage('Entre na sua conta para ver seu perfil.');
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('public_user_directory')
        .select('name, city, score, role')
        .eq('id', authData.user.id)
        .single();

      if (!isMounted) return;
      if (error) setErrorMessage(error.message);
      else setProfile(data as UserProfile);
      setLoading(false);
    }

    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, [supabase]);

  const roleLabel = profile?.role === 'restaurant' ? 'Restaurante' : 'Profissional';

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-xl space-y-6">
        <header>
          <p className="text-sm font-semibold text-orange-700">ExtraChef</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950">Perfil</h1>
        </header>

        {loading ? (
          <LoadingSkeleton label="Carregando perfil..." />
        ) : errorMessage ? (
          <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
            <Toast tone="error">{errorMessage}</Toast>
            <Link href="/login" className="inline-flex min-h-12 items-center font-semibold text-orange-700">Fazer login</Link>
          </div>
        ) : profile ? (
          <article className="space-y-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xl font-bold text-orange-800" aria-hidden="true">
                {profile.name.trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold text-gray-950">{profile.name}</h2>
                <p className="text-sm text-gray-500">{roleLabel}</p>
              </div>
            </div>

            <dl className="grid gap-4 border-t border-gray-100 pt-5 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-gray-500">Cidade</dt>
                <dd className="mt-1 break-words text-sm font-medium text-gray-900">{profile.city || 'Não informada'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500">Score</dt>
                <dd className="mt-1 text-sm font-medium text-gray-900">{Number(profile.score ?? 0).toFixed(2)}</dd>
              </div>
            </dl>

            <LogoutButton />
          </article>
        ) : null}
      </section>
      {profile && <MobileBottomNav role={profile.role} />}
    </main>
  );
}