'use client';

import { Button, LoadingSkeleton } from '@/app/components/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getAccountRole } from '@/lib/auth/account';
import { isLoggingOut } from '@/lib/auth/logout';
import { authMessages, canAccessPath, dashboardFor, isProtectedPath, loginHref } from '@/lib/auth/routes';

export default function SessionGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const protectedPage = isProtectedPath(pathname);
  const [supabase] = useState(() => createClient());
  const [verified, setVerified] = useState<{ path: string; userId: string } | null>(null);
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!protectedPage) return;
    let active = true;
    let checking = false;
    let currentUserId: string | null = null;

    const requireLogin = () => {
      setVerified(null);
      if (isLoggingOut()) return;
      window.location.replace(loginHref(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
        'session_expired',
      ));
    };

    async function verify() {
      if (!active || checking) return;
      checking = true;
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!active) return;
        if (error && error.name !== 'AuthSessionMissingError'
          && (!error.status || error.status >= 500)) {
          throw new Error('Não foi possível validar sua sessão. Verifique a conexão e tente novamente.');
        }
        if (error || !data.user) {
          requireLogin();
          return;
        }
        if (currentUserId && currentUserId !== data.user.id) {
          window.location.reload();
          return;
        }
        const role = await getAccountRole(supabase, data.user.id);
        if (!active) return;
        if (!canAccessPath(pathname, role)) {
          setVerified(null);
          window.location.replace(`${dashboardFor(role)}?reason=role_forbidden`);
          return;
        }
        currentUserId = data.user.id;
        setFailure(null);
        setVerified({ path: pathname, userId: data.user.id });
        setNotice(authMessages[new URLSearchParams(window.location.search).get('reason') ?? ''] ?? '');
      } catch (error) {
        if (active) {
          setVerified(null);
          setFailure({
            path: pathname,
            message: error instanceof Error ? error.message : 'Não foi possível validar sua sessão.',
          });
        }
      } finally {
        checking = false;
      }
    }

    void verify();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') requireLogin();
      else if (event === 'SIGNED_IN' && currentUserId && session?.user.id !== currentUserId) {
        window.location.reload();
      } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        window.setTimeout(() => { if (active) void verify(); }, 0);
      }
    });
    const onForeground = () => {
      if (document.visibilityState === 'visible') void verify();
    };
    const onPageHide = () => setVerified(null);
    const timer = window.setInterval(() => void verify(), 60_000);
    window.addEventListener('focus', onForeground);
    window.addEventListener('pageshow', onForeground);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onForeground);
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener('focus', onForeground);
      window.removeEventListener('pageshow', onForeground);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onForeground);
    };
  }, [pathname, protectedPage, supabase]);

  if (!protectedPage) return children;
  if (failure?.path === pathname) {
    return (
      <main className="mx-auto w-full max-w-xl space-y-4 p-6">
        <p role="alert">{failure.message}</p>
        <Button type="button" className="min-h-12 rounded-xl border px-4" onClick={() => window.location.reload()}>Tentar novamente</Button>
        <Link href={loginHref(pathname)} className="inline-flex min-h-12 items-center px-4">Fazer login</Link>
      </main>
    );
  }
  if (verified?.path !== pathname) return <LoadingSkeleton label="Validando sua sessão..." />;
  return (
    <>
      {notice && <p role="status" className="bg-orange-50 px-4 py-3 text-sm text-orange-900">{notice}</p>}
      {children}
    </>
  );
}
