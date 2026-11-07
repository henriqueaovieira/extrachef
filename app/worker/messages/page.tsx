'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState, LoadingSkeleton } from '@/app/components/ui';
import DashboardNav from '@/app/components/mobile-bottom-nav';
import NotificationBell from '@/app/components/notification-bell';
import { DashboardAvatar, DashboardLogo } from '@/app/components/dashboard-identity';
import { createClient } from '@/lib/supabase/client';

interface ApprovedJob {
  job_id: string;
  job: {
    title: string;
    job_date: string;
    start_time: string;
    restaurant: { name: string } | null;
  } | null;
}

interface WorkerConversation extends NonNullable<ApprovedJob['job']> {
  job_id: string;
  latest_message: string;
  latest_message_at: string;
}

export default function WorkerMessagesPage() {
  const [supabase] = useState(() => createClient());
  const [profile, setProfile] = useState<{ name: string; photoUrl: string | null }>({ name: '', photoUrl: null });
  const [conversations, setConversations] = useState<WorkerConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadMessages() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          if (active) {
            setSignedIn(false);
            setLoading(false);
          }
          return;
        }

        const userId = authData.user.id;
        const [profileResult, photoResult, applicationsResult] = await Promise.all([
  supabase
    .from('public_user_directory')
    .select('name')
    .eq('id', userId)
    .single(),

  supabase
    .from('worker_profiles')
    .select('profile_photo_path')
    .eq('user_id', userId)
    .maybeSingle(),

  supabase
    .from('applications')
    .select(
      'job_id, job:jobs(title, job_date, start_time, restaurant:users!restaurant_id(name))'
    )
    .eq('worker_id', userId)
    .in('status', [
      'approved',
      'in_progress',
      'completed',
    ])
    .order('created_at', { ascending: false }),
]);

        if (!active) return;
        if (profileResult.error) console.error('Worker profile lookup failed.', profileResult.error);
        else setProfile((current) => ({ ...current, name: profileResult.data?.name ?? '' }));

        if (photoResult.error) {
          console.error('Worker profile photo lookup failed.', photoResult.error);
        } else if (photoResult.data?.profile_photo_path) {
          const { data: signedPhoto, error: photoError } = await supabase.storage
            .from('worker-private')
            .createSignedUrl(photoResult.data.profile_photo_path, 60 * 10);
          if (photoError) console.error('Worker profile photo signing failed.', photoError);
          else if (active && signedPhoto?.signedUrl) {
            setProfile((current) => ({ ...current, photoUrl: signedPhoto.signedUrl }));
          }
        }

        if (applicationsResult.error) throw applicationsResult.error;
        const approvedJobs = (applicationsResult.data ?? []) as unknown as ApprovedJob[];
        const jobsWithConversation = approvedJobs.filter((item) => item.job !== null);
        const latestMessages = await Promise.all(jobsWithConversation.map(async (item) => {
          const { data, error: messageError } = await supabase.from('messages')
            .select('content, created_at')
            .eq('job_id', item.job_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (messageError) throw messageError;
          return data ? { item, message: data } : null;
        }));

        if (active) {
          setConversations(latestMessages
            .filter((conversation): conversation is NonNullable<typeof conversation> => conversation !== null)
            .map(({ item, message }) => ({ ...item.job!, job_id: item.job_id, latest_message: message.content, latest_message_at: message.created_at }))
            .sort((a, b) => b.latest_message_at.localeCompare(a.latest_message_at)));
        }
      } catch (loadError) {
        console.error('Worker conversations lookup failed.', loadError);
        if (active) setError('Não foi possível carregar suas conversas.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadMessages();
    return () => { active = false; };
  }, [supabase]);

  return (
    <>
      <main className="min-h-screen bg-white pb-[calc(8rem+env(safe-area-inset-bottom))] text-gray-950">
        <header className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 sm:pt-12">
          <div className="mb-8 flex items-center justify-between">
            <DashboardLogo role="worker" />
            <div className="flex items-center gap-3">
              <NotificationBell iconOnly />
              <DashboardAvatar
                role="worker"
                name={profile.name}
                photoUrl={profile.photoUrl}
                onImageError={() => setProfile((current) => ({ ...current, photoUrl: null }))}
              />
            </div>
          </div>
        </header>

        <section className="mx-auto w-full max-w-6xl space-y-6 px-4 sm:px-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Mensagens</h1>
            <p className="mt-1 text-sm text-gray-500">Conversas das suas operações.</p>
          </div>

          {!signedIn ? (
            <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
              <p className="text-gray-700">Entre na sua conta para ver suas conversas.</p>
              <Link href="/login" className="mt-4 inline-block font-semibold text-orange-700 hover:underline">Fazer login</Link>
            </div>
          ) : loading ? (
            <LoadingSkeleton label="Carregando conversas..." />
          ) : error ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
          ) : conversations.length === 0 ? (
            <EmptyState title="Ainda não existem conversas." description="As mensagens das operações aparecerão aqui." />
          ) : (
            <div className="grid gap-3">
              {conversations.map((conversation) => (
                <Link
                  key={conversation.job_id}
                  href={`/chat/${conversation.job_id}`}
                  className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 transition hover:border-orange-200 hover:bg-orange-50/30 sm:p-5"
                >
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="break-words font-semibold text-gray-950">{conversation.title}</h2>
                      <p className="mt-1 break-words text-sm text-gray-600">{conversation.restaurant?.name ?? 'Estabelecimento'}</p>
                    </div>
                    <time className="shrink-0 text-xs text-gray-500" dateTime={conversation.latest_message_at}>
                      {new Date(conversation.latest_message_at).toLocaleDateString('pt-BR')}
                    </time>
                  </div>
                  <p className="mt-3 line-clamp-2 break-words text-sm text-gray-600">{conversation.latest_message}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <DashboardNav role="worker" showOnDesktop />
    </>
  );
}
