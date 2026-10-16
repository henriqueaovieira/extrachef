'use client';

import Link from 'next/link';
import { useCommunication } from '@/app/components/communication-state';

export default function NotificationBell() {
  const { counts, error } = useCommunication();
  const count = counts.notifications;
  return (
    <Link href="/notifications" aria-label={count && count > 0 ? `Notificações: ${count} não lidas` : 'Notificações'}
      title={error || undefined}
      className="relative inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800">
      <span aria-hidden="true">🔔</span>
      <span>Notificações</span>
      {count !== null && count > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}
