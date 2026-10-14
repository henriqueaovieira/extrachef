'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type UserRole = 'restaurant' | 'worker';

const navigationItems: Record<UserRole, Array<{ href: string; label: string; icon: string }>> = {
  restaurant: [
    { href: '/restaurant/dashboard', label: 'Início', icon: '🏠' },
    { href: '/restaurant/dashboard/jobs/create', label: 'Vagas', icon: '💼' },
    { href: '/restaurant/candidates#chats', label: 'Chat', icon: '💬' },
    { href: '/restaurant/profile', label: 'Perfil', icon: '👤' },
  ],
  worker: [
    { href: '/worker/dashboard', label: 'Início', icon: '🏠' },
    { href: '/worker/dashboard#jobs', label: 'Vagas', icon: '💼' },
    { href: '/worker/applications#chats', label: 'Chat', icon: '💬' },
    { href: '/worker/profile', label: 'Perfil', icon: '👤' },
  ],
};

export default function MobileBottomNav({ role }: { role: UserRole }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(17,24,39,0.06)] backdrop-blur md:hidden"
    >
      <div className="mx-auto grid min-h-16 max-w-xl grid-cols-4 px-1">
        {navigationItems[role].map((item) => {
          const itemPath = item.href.split('#')[0];
          const isChatRoute = item.label === 'Chat' && pathname.startsWith('/chat/');
          const isActive = pathname === itemPath || pathname.startsWith(`${itemPath}/`) || isChatRoute;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-center transition ${isActive ? 'text-orange-700' : 'text-gray-500 hover:text-gray-800'}`}
            >
              <span aria-hidden="true" className="text-lg leading-5">{item.icon}</span>
              <span className="truncate text-[10px] font-semibold leading-4 xs:text-[11px]">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}