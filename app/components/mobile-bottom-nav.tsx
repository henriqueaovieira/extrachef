'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useCommunication } from '@/app/components/communication-state';
import { Badge } from '@/app/components/ui';

type UserRole = 'restaurant' | 'worker';

function subscribeToViewport(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function getCompactMode() {
  return window.innerWidth <= 375;
}

function getServerCompactMode() {
  return false;
}

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
    { href: '/worker/profile', label: 'Perfil', icon: 'team' },
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
  const compactMode = useSyncExternalStore(
    subscribeToViewport,
    getCompactMode,
    getServerCompactMode,
  );
  const diagnosticNavigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const navigation = diagnosticNavigation.current;
    if (!navigation) return;
    navigation.dataset.diagnosticHydrated = 'true';
    navigation.dataset.diagnosticCommit = JSON.stringify({
      innerWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      compactMode,
    });
  }, [compactMode]);

  return (
    <nav
      ref={diagnosticNavigation}
      data-diagnostic-source="a11y004-probe-v1"
      data-diagnostic-compact-mode={String(compactMode)}
      aria-label="Navegação principal"
      className={`ec-mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] ${showOnDesktop ? '' : 'md:hidden'}`}
    >
      <div className={`mx-auto grid min-h-16 max-w-xl ${role === 'restaurant' ? 'grid-cols-6' : 'grid-cols-4'} p-1`}>
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
                : item.label === 'Perfil'
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
              className="ec-mobile-nav__item flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 text-center transition"
            >
              <span aria-hidden="true" className="relative text-lg leading-5"><RestaurantNavIcon name={item.icon} />
                {unread !== null && unread > 0 && (
                  <Badge tone="info" className="ec-mobile-nav__badge">
                    {unread > 99 ? '99+' : unread}
                  </Badge>
                )}
              </span>
              <span className={`ec-mobile-nav__label max-w-full whitespace-normal text-[10px] font-semibold leading-4 sm:text-xs ${compactMode ? 'hidden' : ''}`}>{item.label}</span>
            </Link>
          );
        })}
      </div>
      {chatErrorMessage && <p role="alert" className="ec-mobile-nav__error ec-operational-panel__danger absolute inset-x-0 bottom-full border-t border-gray-200 text-center text-xs">{chatErrorMessage}</p>}
    </nav>
  );
}