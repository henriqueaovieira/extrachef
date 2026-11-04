'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, LoadingSkeleton, TextInput, Toast } from '@/app/components/ui';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { DashboardLogo } from '@/app/components/dashboard-identity';
import { createClient } from '@/lib/supabase/client';
import ProfessionalVerification from '@/app/components/professional-verification';
import { signDemandPhotos, type DemandPerson } from '@/lib/demand-detail';
import { loadRestaurantMessageInbox, type RestaurantMessageConversation, type RestaurantOperationalStatus } from '@/lib/restaurant-message-inbox';

type MessageConversation = RestaurantMessageConversation & { worker_photo_url?: string | null };

function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function messageTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function statusTone(status: RestaurantOperationalStatus) {
  if (status === 'Em operação' || status === 'Concluída') return 'success';
  if (status === 'Pagamento pendente' || status === 'Checkout pendente' || status === 'Check-in pendente') return 'warning';
  return 'neutral';
}

function ConversationPhoto({ conversation }: { conversation: MessageConversation }) {
  const [failed, setFailed] = useState(false);
  return <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-orange-50 font-semibold text-orange-900">
    {conversation.worker_photo_url && !failed
      ? <Image src={conversation.worker_photo_url} alt="" fill unoptimized sizes="48px" className="object-cover" onError={() => setFailed(true)} />
      : <span aria-hidden="true">{conversation.worker_name.charAt(0).toUpperCase()}</span>}
  </span>;
}

export default function RestaurantMessageCenter() {
  const [supabase] = useState(() => createClient());
  const [conversations, setConversations] = useState<MessageConversation[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadInbox() {
      setLoading(true);
      setError('');
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error('Entre na conta da empresa para acessar as mensagens.');
        const loaded = await loadRestaurantMessageInbox(supabase, authData.user.id);

        const profiles: DemandPerson[] = [...new Map(loaded.filter((conversation) => conversation.worker_photo_path)
          .map((conversation) => [conversation.worker_id, conversation])).values()].map((conversation) => ({
          id: conversation.worker_id,
          name: conversation.worker_name,
          specialties: conversation.worker_specialty ? [conversation.worker_specialty] : null,
          score: conversation.worker_score,
          photo_path: conversation.worker_photo_path,
          experience: null,
          categories: [],
          completed_operations: conversation.completed_operations,
          invitation_status: null,
        }));
        const signedProfiles = await signDemandPhotos(supabase, profiles);
        const photoUrls = new Map(signedProfiles.map((profile) => [profile.id, profile.photoUrl]));
        if (active) setConversations(loaded.map((conversation) => ({
          ...conversation,
          worker_photo_url: photoUrls.get(conversation.worker_id) ?? null,
        })));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar as conversas operacionais.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadInbox();
    return () => {
      active = false;
    };
  }, [retry, refresh, supabase]);

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active || authError || !data.user) return;
      channel = supabase.channel(`restaurant-message-inbox-${data.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
          if (active) setRefresh((current) => current + 1);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'operational_assignments' }, () => {
          if (active) setRefresh((current) => current + 1);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {
          if (active) setRefresh((current) => current + 1);
        })
        .subscribe();
    });
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return conversations.filter((conversation) => {
      const contents = [
        conversation.worker_name,
        conversation.worker_specialty,
        conversation.demand_title,
        conversation.location,
        conversation.latest_message,
      ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return !term || contents.includes(term);
    });
  }, [conversations, search]);

  return (
    <main className="min-h-screen bg-[#fafaf9] px-4 py-6 pb-28 text-gray-950 sm:px-8 sm:py-9">
      <section className="mx-auto max-w-5xl space-y-5">
      <div className="mb-8">
        <DashboardLogo role="restaurant" />
      </div>
      <header>
          <Link href="/restaurant/dashboard" className="mb-3 inline-flex min-h-9 items-center text-xs font-semibold text-gray-500">← Home</Link>
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Mensagens</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Acompanhe suas operações e converse com profissionais já contratados.</p>
        </header>

        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 text-gray-400">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Buscar mensagens</span>
          <TextInput type="search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar profissionais ou operações..."
            className="min-h-10 border-0 bg-transparent px-0 shadow-none focus:border-0 focus:outline-none" />
        </label>

        {error && <Toast tone="error" title="Não foi possível carregar as mensagens."><p>{error}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 underline">Tentar novamente</Button></Toast>}
        {loading ? <div className="space-y-3">{[0, 1, 2].map((index) => <LoadingSkeleton key={index} label="Carregando conversas operacionais..." />)}</div>
          : error ? null
            : filtered.length ? <div className="space-y-3">
              {filtered.map((conversation) => <Card as="article" key={conversation.job_id} className="relative p-0 transition hover:border-orange-300">
                <Link href={`/chat/${conversation.job_id}`}
                  aria-label={`${conversation.worker_name}, ${conversation.worker_specialty ?? 'profissional'}, ${conversation.demand_title}, ${conversation.operational_status}${conversation.unread_count ? `, ${conversation.unread_count} mensagens não lidas` : ''}`}
                  className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-orange-700" />
                <div className="pointer-events-none grid gap-3 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:p-5">
                  <ConversationPhoto conversation={conversation} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <h2 className="flex items-center font-semibold text-gray-950">{conversation.worker_name}<ProfessionalVerification userId={conversation.worker_id} /></h2>
                      <span className="text-xs text-gray-500">{conversation.worker_specialty ?? 'Profissional'}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-gray-800">{conversation.demand_title}</p>
                    <p className="mt-1 text-xs text-gray-500">{dateLabel(conversation.job_date)} · {conversation.start_time.slice(0, 5)} · {conversation.location}</p>
                    <p className={`mt-2 truncate text-sm ${conversation.unread_count ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                      {conversation.latest_message ?? 'Ainda não há mensagens. Combine os detalhes da operação.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 sm:flex-col sm:items-end">
                    <span className="text-xs text-gray-500">{messageTime(conversation.latest_message_at)}</span>
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone(conversation.operational_status)}>{conversation.operational_status}</Badge>
                      {conversation.unread_count > 0 && <Badge tone="warning" aria-label={`${conversation.unread_count} mensagens não lidas`}>
                        {conversation.unread_count > 99 ? '99+' : conversation.unread_count} não lidas
                      </Badge>}
                    </div>
                  </div>
                </div>
              </Card>)}
            </div> : <EmptyState
              icon={<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-9"><path d="M5 8.5A3.5 3.5 0 0 1 8.5 5h15A3.5 3.5 0 0 1 27 8.5v10a3.5 3.5 0 0 1-3.5 3.5H16l-6 5v-5h-1.5A3.5 3.5 0 0 1 5 18.5z" /><path d="M10 12h12m-12 4h8" /></svg>}
              title={conversations.length ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa disponível.'}
              description={conversations.length ? 'Ajuste a busca para localizar outra conversa.' : 'As mensagens serão criadas automaticamente após uma contratação.'}
              action={conversations.length ? <Button onClick={() => setSearch('')}>Limpar busca</Button> : <Link href="/restaurant/demands" className="ec-button ec-button--primary px-4">Ver Operações</Link>}
            />}
      </section>
      <MobileBottomNav role="restaurant" activeItem="Mensagens" showOnDesktop />
    </main>
  );
}
