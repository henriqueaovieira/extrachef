'use client';

import { Button, EmptyState, LoadingSkeleton, Toast } from '@/app/components/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { useCommunication } from '@/app/components/communication-state';

type NotificationCategory = 'application' | 'operational' | 'review' | 'event' | 'reservation';
type Filter = 'all' | 'unread' | NotificationCategory;

interface NotificationRow {
  id: string;
  title: string;
  message: string;
  url: string | null;
  category: NotificationCategory;
  read: boolean;
  created_at: string;
}

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'Não lidas' },
  { value: 'application', label: 'Candidaturas' },
  { value: 'operational', label: 'Operacionais' },
  { value: 'review', label: 'Avaliações' },
  { value: 'event', label: 'Eventos' },
  { value: 'reservation', label: 'Reservas' },
];

export default function NotificationCenter() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'restaurant' | 'worker' | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const { counts, error: countError, refresh } = useCommunication();
  const requestVersion = useRef(0);
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);

  const loadNotifications = useCallback(async (currentUserId: string) => {
    const version = ++requestVersion.current;
    let query = supabase
      .from('notifications')
      .select('id, title, message, url, category, read, created_at')
      .eq('user_id', currentUserId)
      .neq('category', 'message')
      .order('created_at', { ascending: false })
      .limit(pageSize);

    if (filter === 'unread') query = query.eq('read', false);
    else if (filter !== 'all') query = query.eq('category', filter);

    const { data, error } = await query;
    if (version !== requestVersion.current) return;
    if (error) {
      setNotifications([]);
      setErrorMessage('Não foi possível carregar as notificações.');
      return;
    }

    setErrorMessage('');
    setNotifications((data ?? []) as NotificationRow[]);
  }, [filter, supabase, pageSize]);

  useEffect(() => {
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function initialize() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (authError || !authData.user) {
        setErrorMessage('Entre na sua conta para ver suas notificações.');
        setLoading(false);
        return;
      }

      const currentUserId = authData.user.id;
      setUserId(currentUserId);
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', currentUserId)
        .maybeSingle();
      if (mounted && (userData?.role === 'worker' || userData?.role === 'restaurant')) {
        setRole(userData.role);
      }

      channel = supabase
        .channel(`notification-center-${currentUserId}-${crypto.randomUUID()}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        }, () => {
          if (mounted) void loadNotifications(currentUserId);
        })
        .subscribe();

      await loadNotifications(currentUserId);
      if (mounted) setLoading(false);
    }

    void initialize();
    return () => {
      mounted = false;
      invalidateRequests();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [loadNotifications, supabase, invalidateRequests]);

  const markRead = async (notification: NotificationRow) => {
    if (notification.read) return;
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notification.id)
      .neq('category', 'message')
      .eq('user_id', userId);
    if (error) {
      setErrorMessage('Não foi possível marcar a notificação como lida.');
      return;
    }
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, read: true } : item
    )).filter((item) => filter !== 'unread' || !item.read));
    await refresh();
  };

  const markAllRead = async () => {
    if (!userId || busy) return;
    setBusy(true);
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', userId)
      .neq('category', 'message')
      .eq('read', false);
    if (error) setErrorMessage('Não foi possível marcar todas como lidas.');
    else setNotifications((current) => filter === 'unread' ? [] : current.map((item) => ({ ...item, read: true })));
    await refresh();
    setBusy(false);
  };

  const deleteNotification = async (id: string) => {
    if (!userId) return;
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id)
      .neq('category', 'message')
      .eq('user_id', userId);
    if (error) {
      setErrorMessage('Não foi possível excluir a notificação.');
      return;
    }
    setNotifications((current) => current.filter((item) => item.id !== id));
    await refresh();
  };

  const unreadCount = counts.notifications;

  return (
    <main className="min-h-dvh bg-gray-50 px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-10 md:pb-10">
      <section className="mx-auto max-w-3xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-orange-700">ExtraChef</p>
            <h1 className="mt-1 text-2xl font-bold text-gray-950">Notificações</h1>
            <p className="mt-1 text-sm text-gray-600">{unreadCount === null ? countError ? 'Indicadores indisponíveis' : 'Atualizando indicadores...' : `${unreadCount} não lida(s)`}</p>
            <Link href={role === 'restaurant' ? '/restaurant/dashboard' : '/worker/dashboard'} className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-700">Voltar ao Dashboard</Link>
          </div>
          <Button
            type="button"
            onClick={() => void markAllRead()}
            disabled={busy || unreadCount === null || unreadCount === 0}
            className="min-h-12 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 disabled:opacity-50"
          >
            Marcar todas como lidas
          </Button>
        </header>

        <Link href={role === 'restaurant' ? '/restaurant/candidates#chats' : '/worker/applications#chats'} className="inline-flex min-h-12 items-center rounded-lg border border-gray-300 bg-white px-4 font-semibold text-gray-800">
          Mensagens {counts.messages !== null && counts.messages > 0 ? `(${counts.messages})` : ''}
        </Link>
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar notificações">
          {filters.map((item) => (
            <Button
              key={item.value}
              type="button"
              onClick={() => { setFilter(item.value); setPageSize(100); }}
              aria-pressed={filter === item.value}
              className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${filter === item.value ? 'bg-orange-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {errorMessage && <Toast tone="error">{errorMessage}</Toast>}
        {countError && <Toast tone="error">{countError}</Toast>}
        {loading ? (
          <LoadingSkeleton label="Carregando notificações..." />
        ) : errorMessage && notifications.length === 0 ? (
          <EmptyState icon="!" title="Não foi possível consultar seus avisos"
            description="Não podemos confirmar se há notificações. Tente carregar novamente."
            action={<Button onClick={() => { if (userId) void loadNotifications(userId); }}>Tentar novamente</Button>} />
        ) : notifications.length === 0 ? (
          <EmptyState icon="♧" title={filter === 'all' ? 'Tudo em dia por aqui' : 'Nenhum aviso neste filtro'}
            description={filter === 'all' ? 'As atualizações da sua operação aparecerão aqui. Suas conversas ficam no Chat.' : 'Tente outro filtro para consultar suas atualizações.'}
            action={filter !== 'all' ? <Button onClick={() => setFilter('all')}>Ver todas</Button> : undefined} />
        ) : (
          <ul className="space-y-3">
            {notifications.map((notification) => (
              <li key={notification.id} className={`rounded-xl border bg-white p-4 shadow-sm ${notification.read ? 'border-gray-200' : 'border-orange-200'}`}>
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className={`mt-1 size-2.5 shrink-0 rounded-full ${notification.read ? 'bg-gray-200' : 'bg-orange-600'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-950">{notification.title}</p>
                    <p className="mt-1 text-sm leading-5 text-gray-600">{notification.message}</p>
                    <time className="mt-2 block text-xs text-gray-400" dateTime={notification.created_at}>
                      {new Date(notification.created_at).toLocaleString('pt-BR')}
                    </time>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {notification.url && (
                        <Link
                          href={notification.url}
                          onClick={() => void markRead(notification)}
                          className="inline-flex min-h-11 items-center rounded-lg bg-orange-700 px-4 text-sm font-semibold text-white"
                        >
                          {notification.category === 'application' && notification.url === '/restaurant/candidates'
                            ? 'Ver candidatura' : 'Abrir'}
                        </Link>
                      )}
                      {!notification.read && (
                        <Button type="button" onClick={() => void markRead(notification)} className="min-h-11 rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-700">
                          Marcar como lida
                        </Button>
                      )}
                      <Button type="button" onClick={() => void deleteNotification(notification.id)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-gray-500 hover:bg-gray-100">
                        Excluir
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {!loading && notifications.length === pageSize && (
          <Button onClick={() => setPageSize((current) => current + 100)}>Carregar mais notificações</Button>
        )}
      </section>
      {role && <MobileBottomNav role={role} />}
    </main>
  );
}
