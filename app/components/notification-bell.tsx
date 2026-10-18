'use client';

import Link from 'next/link';
import { useCommunication } from '@/app/components/communication-state';

export default function NotificationBell({ iconOnly = false }: { iconOnly?: boolean }) {
  const { counts, error } = useCommunication();
  const count = counts.notifications;
  return (
    <Link href="/notifications" aria-label={count && count > 0 ? `Notificações: ${count} não lidas` : 'Notificações'}
      title={error || undefined}
      className={`relative inline-flex min-h-11 items-center justify-center gap-2 bg-white text-sm font-semibold text-gray-800 ${iconOnly ? 'size-11 rounded-full hover:bg-gray-50' : 'rounded-lg border border-gray-200 px-3'}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {!iconOnly && <span>Notificações</span>}
      {count !== null && count > 0 && <span className={`rounded-full bg-red-600 px-1.5 text-xs text-white ${iconOnly ? 'absolute -top-0.5 -right-1' : ''}`}>{count > 99 ? '99+' : count}</span>}
    </Link>
  );
}
