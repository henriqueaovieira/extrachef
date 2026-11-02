'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCommunication } from '@/app/components/communication-state';

type UserRole = 'restaurant' | 'worker';

const navigationItems: Record<UserRole, Array<{ href: string; label: string; icon: string }>> = {
  restaurant: [
    { href: '/restaurant/dashboard', label: 'Home', icon: 'home' },
    { href: '/restaurant/demands', label: 'Operações', icon: 'demands' },
    { href: '/restaurant/candidates', label: 'Talentos', icon: 'talents' },
    { href: '/restaurant/team', label: 'Equipe', icon: 'team' },
    { href: '/restaurant/messages', label: 'Mensagens', icon: 'messages' },
    { href: '/restaurant/more', label: 'Mais', icon: 'more' },
  ],
  worker: [
    { href: '/worker/dashboard', label: 'Home', icon: 'home' },
    { href: '/worker/applications', label: 'Minhas Candidaturas', icon: 'applications' },
    { href: '/worker/messages', label: 'Mensagens', icon: 'messages' },
    { href: '/worker/profile', label: 'Mais', icon: 'more' },
  ],
};

function RestaurantNavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
    demands: <><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5V3h6v2M9 11h6m-6 5h4" /></>,
    applications: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6m-6 4h6m-6 4h4" /></>,
    talents: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" /></>,
    messages: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H7l-4 2v-7A8.5 8.5 0 1 1 21 11.5Z" />,
    team: <><circle cx="12" cy="7" r="3" /><circle cx="5" cy="10" r="2" /><circle cx="19" cy="10" r="2" /><path d="M7 21v-2a5 5 0 0 1 10 0v2M2 20v-1a3 3 0 0 1 4-3m16 4v-1a3 3 0 0 0-4-3" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5">{paths[name]}</svg>;
}

export default function MobileBottomNav({ role, activeItem, showOnDesktop = false }: { role: UserRole; activeItem?: 'Talentos' | 'Mensagens'; showOnDesktop?: boolean }) {
  const pathname = usePathname();
  const { counts, chatError } = useCommunication();
  const chatErrorMessage = role === 'worker' && chatError ? 'Não foi possível atualizar as mensagens.' : chatError;

  return (
    <nav
      aria-label="Navegação principal"
      className={`ec-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur ${showOnDesktop ? '' : 'md:hidden'}`}
    >
      <div className={`mx-auto grid min-h-16 max-w-xl ${role === 'restaurant' ? 'grid-cols-6' : 'grid-cols-4'} px-1`}>
        {navigationItems[role].map((item) => {
          const itemPath = item.href.split(/[?#]/)[0];
          const isMessages = item.label === 'Mensagens';
          const isChatRoute = isMessages && pathname.startsWith('/chat/');
          const isActive = role === 'restaurant'
            ? isChatRoute || (((pathname === itemPath || (item.label === 'Mensagens' && pathname === '/restaurant/candidates' && activeItem === 'Mensagens')) && (item.label === 'Mensagens'
              ? activeItem === 'Mensagens'
              : item.label !== 'Talentos' || activeItem !== 'Mensagens'))
              || (item.label === 'Operações' && (pathname.startsWith('/restaurant/dashboard/jobs') || pathname.startsWith('/restaurant/demands/')))
              || (item.label === 'Mais' && ['/restaurant/profile', '/restaurant/history', '/settings', '/notifications'].some((path) => pathname.startsWith(path))))
            : item.label === 'Mensagens'
              ? isChatRoute || pathname === itemPath
              : item.label === 'Minhas Candidaturas'
                ? pathname === itemPath || pathname.startsWith('/worker/invitations')
                : item.label === 'Mais'
                  ? ['/worker/profile', '/notifications', '/settings'].some((path) => pathname.startsWith(path))
                  : pathname === itemPath;
          const unread = isMessages ? counts.messages : null;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              aria-label={unread !== null && unread > 0 ? `${item.label}: ${unread} não lidas` : item.label}
              title={isMessages ? chatErrorMessage || undefined : undefined}
              className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-center transition ${isActive ? 'text-orange-700' : 'text-gray-500 hover:text-gray-800'}`}
            >
              <span aria-hidden="true" className="relative text-lg leading-5"><RestaurantNavIcon name={item.icon} />
                {unread !== null && unread > 0 && (
                  <span className="absolute -right-4 -top-2 min-w-4 rounded-full bg-red-600 px-1 text-[9px] leading-4 text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </span>
              <span className="max-w-full whitespace-normal text-[10px] font-semibold leading-3 xs:text-[11px] xs:leading-4">{item.label}</span>
            </Link>
          );
        })}
      </div>
      {chatErrorMessage && <p role="status" className="absolute inset-x-0 bottom-full border-t border-red-100 bg-red-50 px-3 py-2 text-center text-xs text-red-700">{chatErrorMessage}</p>}
    </nav>
  );
}