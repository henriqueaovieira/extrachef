'use client';

import { LoadingSkeleton, Toast } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import PushNotificationControl from '@/app/components/push-notification-control';
import LogoutButton from '@/app/components/logout-button';
import ProfileProgress from '@/app/components/profile-progress';
import { getProfileProgress } from '@/lib/ui/profile-progress';
import OperationalReputationView from '@/app/components/operational-reputation';
import { DashboardLogo } from '@/app/components/dashboard-identity';
import ProfileVerification from '@/app/components/profile-verification';
import VerifiedProfileBadge from '@/app/components/verified-profile-badge';
import { getVerificationState, type VerificationProfile } from '@/lib/profile-verification';
import { MoreNavigationLinks } from '@/app/components/more-navigation';

type ProfileRole = 'worker' | 'restaurant';

interface ProfileView {
  name: string;
  role: ProfileRole;
  city: string | null;
  details: Array<[string, string]>;
  imageUrl: string | null;
  gallery: string[];
  verification: VerificationProfile | null;
}

export default function ProfileOverview({ role }: { role: ProfileRole }) {
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [progress, setProgress] = useState<ReturnType<typeof getProfileProgress> | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadProfile() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        if (isMounted) {
          setErrorMessage('Entre na sua conta para visualizar o perfil.');
          setLoading(false);
        }
        return;
      }

      const { data: user, error: userError } = await supabase
        .from('public_user_directory')
        .select('name, role, city')
        .eq('id', authData.user.id)
        .single();

      if (userError || user.role !== role) {
        if (isMounted) {
          setErrorMessage('Este perfil não corresponde ao tipo da sua conta.');
          setLoading(false);
        }
        return;
      }

      if (role === 'worker') {
        const { data, error } = await supabase
          .from('worker_profiles')
          .select('*')
          .eq('user_id', authData.user.id)
          .maybeSingle();
        if (isMounted && !error) setProgress(getProfileProgress(role, user.name, data ?? { city: user.city }));
        if (error) {
          if (isMounted) setErrorMessage(error.message);
        } else if (data) {
          let imageUrl: string | null = null;
          if (data.profile_photo_path) {
            const { data: signedImage } = await supabase.storage
              .from('worker-private')
              .createSignedUrl(data.profile_photo_path, 60 * 10);
            imageUrl = signedImage?.signedUrl ?? null;
          }
          if (isMounted) {
            setProfile({
              name: user.name,
              role,
              city: data.city,
              imageUrl,
              gallery: [],
              verification: {
                cpf: data.cpf, rg: data.rg, phone: data.phone,
                selfie_verification_path: data.selfie_verification_path,
                verification_status: data.verification_status,
              },
              details: [
                ['CPF', data.cpf],
                ['RG', data.rg],
                ['Nascimento', new Date(`${data.date_of_birth}T00:00:00`).toLocaleDateString('pt-BR')],
                ['Telefone', data.phone],
                ['Endereço', `${data.address}, ${data.city} - ${data.state}, ${data.postal_code}`],
                ['Experiência', data.experience || 'Não informada'],
                ['Especialidades', (data.specialties ?? []).join(', ') || 'Não informadas'],
              ],
            });
          }
        }
      } else {
        const { data, error } = await supabase
          .from('restaurant_profiles')
          .select('*')
          .eq('user_id', authData.user.id)
          .maybeSingle();
        if (isMounted && !error) setProgress(getProfileProgress(role, data?.trade_name ?? user.name, data ?? { city: user.city }));
        if (error) {
          if (isMounted) setErrorMessage(error.message);
        } else if (data) {
          const logo = data.logo_path
            ? await supabase.storage.from('restaurant-assets').createSignedUrl(data.logo_path, 300)
            : null;
          const imageUrl = logo?.data?.signedUrl ?? null;
          const photos = await Promise.all((data.company_photos ?? []).map(async (path: string) => {
            const signed = await supabase.storage.from('restaurant-assets').createSignedUrl(path, 300);
            return signed.data?.signedUrl ?? null;
          }));
          const gallery = photos.filter((url): url is string => Boolean(url));
          if (isMounted) {
            setProfile({
              name: data.trade_name,
              role,
              city: data.city,
              imageUrl,
              gallery,
              verification: null,
              details: [
                ['Razão social', data.legal_name],
                ['CNPJ', data.cnpj],
                ['Telefone', data.phone],
                ['WhatsApp', data.whatsapp],
                ['Endereço', `${data.address}, ${data.city} - ${data.state}, ${data.postal_code}`],
                ['Descrição', data.description || 'Não informada'],
              ],
            });
          }
        }
      }

      if (isMounted) setLoading(false);
    }

    let refreshing = false;
    const refresh = async () => {
      if (refreshing || !isMounted) return;
      refreshing = true;
      try { await loadProfile(); }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [role, supabase]);

  useEffect(() => {
    if (loading || role !== 'worker') return;
    const id = window.location.hash.slice(1);
    if (id !== 'verification' && id !== 'confidence') return;
    document.getElementById(id)?.scrollIntoView();
  }, [loading, role]);

  const editHref = role === 'worker' ? '/worker/profile?edit=1' : '/restaurant/profile/edit';
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <DashboardLogo role={role} />
            <h1 className="mt-1 text-2xl font-bold text-gray-950">Meu Perfil</h1>
          </div>
          {role === 'restaurant' ? (
            <Link href="/restaurant/more" className="inline-flex min-h-12 items-center text-sm font-semibold text-gray-600">← Mais</Link>
          ) : (
            <Link href="/worker/dashboard" className="inline-flex min-h-12 items-center text-sm font-semibold text-gray-600">← Início</Link>
          )}
        </header>

        {!loading && !errorMessage && progress && <ProfileProgress progress={progress} />}
        {loading ? (
          <LoadingSkeleton label="Carregando perfil..." />
        ) : errorMessage ? (
          <div className="space-y-4 rounded-xl border border-red-200 bg-white p-6">
            <Toast tone="error">{errorMessage}</Toast>
            {errorMessage.includes('Entre') && <Link href="/login" className="inline-flex min-h-12 items-center font-semibold text-orange-700">Fazer login</Link>}
          </div>
        ) : !profile ? (
          <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-600">Complete seu perfil para manter seus dados atualizados.</p>
            <Link href={editHref} className="inline-flex min-h-12 items-center rounded-lg bg-orange-700 px-4 text-sm font-semibold text-white">Completar perfil</Link>
          </div>
        ) : (
          <article className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-center gap-4">
              {profile.imageUrl ? (
                <Image src={profile.imageUrl} alt="Imagem do perfil" width={64} height={64} unoptimized className="size-16 rounded-full border border-gray-200 object-cover" />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full bg-orange-100 text-xl font-bold text-orange-800">{profile.name.trim().charAt(0).toUpperCase()}</div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-xl font-bold text-gray-950">{profile.name}{profile.verification && getVerificationState(profile.verification) === 'verified' && <VerifiedProfileBadge />}</h2>
                <p className="text-sm text-gray-600">{profile.role === 'worker' ? 'Profissional' : 'Restaurante'} · {profile.city || 'Cidade não informada'}</p>
              </div>
              <Link href={editHref} className="inline-flex min-h-12 items-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">Editar perfil</Link>
              {role === 'worker' && <Link href="/worker/profile#verification" className="inline-flex min-h-12 items-center text-sm font-semibold text-orange-700">Verificação</Link>}
            </div>

            {profile.verification && <ProfileVerification profile={profile.verification} onSubmitted={(path) => {
              setProfile((current) => current?.verification ? {
                ...current, verification: { ...current.verification, selfie_verification_path: path, verification_status: 'pending' },
              } : current);
            }} />}

            <dl className="grid gap-x-6 gap-y-4 border-t border-gray-100 pt-5 sm:grid-cols-2">
              {profile.details.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs font-medium text-gray-500">{label}</dt>
                  <dd className="mt-1 break-words text-sm text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>

            {profile.gallery.length > 0 && (
              <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-5 sm:grid-cols-3">
                {profile.gallery.map((image, index) => <Image key={image} src={image} alt={`Foto do estabelecimento ${index + 1}`} width={480} height={480} unoptimized className="aspect-square w-full rounded-lg object-cover" />)}
              </div>
            )}
          </article>
        )}
        {profile && (
          <>
            {role === 'worker' && <div id="confidence"><OperationalReputationView /></div>}
            <PushNotificationControl />
            {role === 'restaurant' && <Link href="/settings/privacy" className="flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              Preferências de notificações e privacidade
            </Link>}
          </>
        )}
      </section>
      {role === 'worker' && <section aria-labelledby="profile-navigation-heading" className="mx-auto mt-6 max-w-2xl">
        <h2 id="profile-navigation-heading" className="text-lg font-semibold">Acessos da conta</h2>
        <MoreNavigationLinks role="worker" />
      </section>}
      <section className="mx-auto mt-6 max-w-2xl">
        <LogoutButton />
      </section>
      {(profile || role === 'worker') && <MobileBottomNav role={role} showOnDesktop={role === 'worker'} />}
    </main>
  );
}