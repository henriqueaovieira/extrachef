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

type ProfileRole = 'worker' | 'restaurant';

interface ProfileView {
  name: string;
  role: ProfileRole;
  city: string | null;
  score: number | null;
  details: Array<[string, string]>;
  imageUrl: string | null;
  gallery: string[];
  verificationStatus: string | null;
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
        .select('name, role, city, score')
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
              score: user.score,
              imageUrl,
              gallery: [],
              verificationStatus: data.verification_status,
              details: [
                ['CPF', data.cpf],
                ['RG', data.rg],
                ['Nascimento', new Date(`${data.date_of_birth}T00:00:00`).toLocaleDateString('pt-BR')],
                ['Telefone', data.phone],
                ['WhatsApp', data.whatsapp],
                ['Endereço', `${data.address}, ${data.city} - ${data.state}, ${data.postal_code}`],
                ['Experiência', data.experience || 'Não informada'],
                ['Especialidades', (data.specialties ?? []).join(', ') || 'Não informadas'],
                ['Certificados', `${(data.certificates ?? []).length} arquivo(s)`],
                ['Currículo', data.resume_pdf_path ? 'PDF enviado' : 'Não enviado'],
                ['Selfie', data.selfie_verification_path ? 'Enviada' : 'Não enviada'],
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
              score: user.score,
              imageUrl,
              gallery,
              verificationStatus: null,
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

    void loadProfile();
    return () => {
      isMounted = false;
    };
  }, [role, supabase]);

  const editHref = role === 'worker' ? '/worker/profile/edit' : '/restaurant/profile/edit';
  const dashboardHref = role === 'worker' ? '/worker/dashboard' : '/restaurant/dashboard';

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 pb-28 sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-orange-700">ExtraChef</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-950">Perfil</h1>
          </div>
          <Link href={dashboardHref} className="inline-flex min-h-12 items-center text-sm font-semibold text-gray-600">Início</Link>
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
                <h2 className="break-words text-xl font-bold text-gray-950">{profile.name}</h2>
                <p className="text-sm text-gray-600">{profile.role === 'worker' ? 'Profissional' : 'Restaurante'} · {profile.city || 'Cidade não informada'}</p>
                {profile.role === 'worker' && <p className="mt-1 text-sm font-semibold text-amber-700">Score {Number(profile.score ?? 0).toFixed(2)}</p>}
              </div>
              <Link href={editHref} className="inline-flex min-h-12 items-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">Editar perfil</Link>
            </div>

            {profile.verificationStatus && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Verificação: {profile.verificationStatus === 'pending' ? 'Pendente' : profile.verificationStatus === 'verified' ? 'Verificada' : 'Requer revisão'}</p>
            )}

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
            <PushNotificationControl />
            <Link href="/settings/privacy" className="flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50">
              Preferências de notificações e privacidade
            </Link>
          </>
        )}
      </section>
      <section className="mx-auto mt-6 max-w-2xl">
        <LogoutButton />
      </section>
      {profile && <MobileBottomNav role={profile.role} />}
    </main>
  );
}