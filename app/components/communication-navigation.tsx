'use client';

import Link from 'next/link';
import NotificationBell from '@/app/components/notification-bell';
import { useCommunication } from '@/app/components/communication-state';

export default function CommunicationNavigation({ role }: { role: 'restaurant' | 'worker' }) {
  const { counts, chatError } = useCommunication();
  const count = counts.messages;
  return (
    <nav aria-label="Comunicação" className="hidden items-center gap-2 md:flex">
      <Link href={role === 'restaurant' ? '/restaurant/messages' : '/worker/messages'}
        aria-label={count !== null && count > 0 ? `Mensagens: ${count} não lidas` : 'Mensagens'}
        title={chatError || undefined}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800">
        <span aria-hidden="true">💬</span> Mensagens
        {count !== null && count > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{count > 99 ? '99+' : count}</span>}
      </Link>
      <NotificationBell />
    </nav>
  );
}
