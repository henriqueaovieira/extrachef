'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Toast } from '@/app/components/ui';
import VerifiedProfileBadge from '@/app/components/verified-profile-badge';

const VerificationContext = createContext<{
  verified: ReadonlySet<string>;
  register: (id: string) => () => void;
} | null>(null);

export function ProfessionalVerificationProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [registrations, setRegistrations] = useState<Record<string, number>>({});
  const [verified, setVerified] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');
  const pathname = usePathname();
  const register = useCallback((id: string) => {
    setRegistrations((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
    return () => setRegistrations((current) => {
      const next = { ...current };
      if (next[id] > 1) next[id] -= 1;
      else delete next[id];
      return next;
    });
  }, []);
  const ids = Object.keys(registrations).sort().join(',');

  useEffect(() => {
    let active = true;
    let version = 0;
    async function refresh() {
      const requestVersion = ++version;
      const keys = ids ? ids.split(',') : [];
      if (!keys.length) { setVerified(new Set()); setError(''); return; }
      try {
        const jobIds = keys.filter((key) => key.startsWith('job:')).map((key) => key.slice(4));
        const jobs = new Map<string, string>();
        for (let index = 0; index < jobIds.length; index += 100) {
          const { data, error } = await supabase.from('applications').select('job_id, worker_id')
            .in('job_id', jobIds.slice(index, index + 100)).in('status', ['approved', 'in_progress', 'completed']);
          if (error) throw new Error(error.message);
          for (const row of data ?? []) jobs.set(`job:${row.job_id}`, row.worker_id);
        }
        const userIds = [...new Set(keys.filter((key) => !key.startsWith('job:')).concat([...jobs.values()]))];
        const batches: string[][] = [];
        for (let index = 0; index < userIds.length; index += 100) batches.push(userIds.slice(index, index + 100));
        const results = await Promise.all(batches.map((batch) => supabase
          .from('public_user_directory').select('id, profile_verified').in('id', batch)));
        if (!active || requestVersion !== version) return;
        const failure = results.find((result) => result.error)?.error;
        if (failure) throw new Error(failure.message);
        const next = new Set<string>(results.flatMap((result) => (result.data ?? [])
          .filter((row) => row.profile_verified === true).map((row) => row.id)));
        for (const [key, userId] of jobs) if (next.has(userId)) next.add(key);
        setVerified(next);
        setError('');
      } catch (failure) {
        if (!active || requestVersion !== version) return;
        console.error('Falha ao carregar selos de perfil verificado:', failure instanceof Error ? failure.message : failure);
        setVerified(new Set());
        setError('Não foi possível atualizar os selos de Perfil Verificado.');
      }
    }
    const timeout = window.setTimeout(() => void refresh(), 30);
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      ++version;
      setVerified(new Set());
      window.setTimeout(() => { if (active) void refresh(); }, 0);
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      listener.subscription.unsubscribe();
    };
  }, [ids, pathname, supabase]);

  const value = useMemo(() => ({ verified, register }), [verified, register]);
  return (
    <VerificationContext.Provider value={value}>
      {error && <div className="mx-auto w-full max-w-2xl p-4"><Toast tone="error">{error}</Toast></div>}
      {children}
    </VerificationContext.Provider>
  );
}

export default function ProfessionalVerification({ userId, jobId }: {
  userId?: string | null;
  jobId?: string;
}) {
  const context = useContext(VerificationContext);
  const register = context?.register;
  const key = userId || (jobId ? `job:${jobId}` : null);
  useEffect(() => {
    if (key && register) return register(key);
  }, [key, register]);
  return key && context?.verified.has(key) ? <VerifiedProfileBadge /> : null;
}
