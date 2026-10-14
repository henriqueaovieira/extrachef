'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

interface Notification {
  id: string;
  title: string;
  message: string;
  url: string | null;
  read: boolean;
  created_at: string;
}

export default function NotificationBell() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadNotifications() {
      const { data: authData } = await supabase.auth.getUser();
      const user = authData.user;
      if (!isMounted || !user) return;
      setUserId(user.id);

      const refreshNotifications = async () => {
        if (!isMounted) return;
        const { data } = await supabase
          .from('notifications')
          .select('id, title, message, url, read, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10);

        if (isMounted) setNotifications((data ?? []) as Notification[]);
      };

      channel = supabase
        .channel(`notifications-${user.id}-${crypto.randomUUID()}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => void refreshNotifications(),
        )
        .subscribe();

      await refreshNotifications();
    }

    void loadNotifications();

    return () => {
      isMounted = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase]);

  const markAsRead = async (notification: Notification) => {
    if (notification.read || !userId) return;

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notification.id)
      .eq('user_id', userId);

    if (!error) {
      setNotifications((current) => current.map((item) => (
        item.id === notification.id ? { ...item, read: true } : item
      )));
    }
  };

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={`Notificações, ${unreadCount} não lidas`}
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        <span>Notificações</span>
        {unreadCount > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-700 px-1.5 py-0.5 text-xs font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <header className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Notificações</h2>
          </header>
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-500">Nenhuma notificação.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <Link
                    href={notification.url || '/'}
                    onClick={() => void markAsRead(notification)}
                    className={`block w-full px-4 py-3 text-left transition hover:bg-gray-50 ${notification.read ? 'bg-white' : 'bg-emerald-50/60'}`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-900">{notification.title}</span>
                      {!notification.read && <span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-600" />}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-gray-600">{notification.message}</span>
                    <time className="mt-2 block text-[11px] text-gray-400">
                      {new Date(notification.created_at).toLocaleString('pt-BR')}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}