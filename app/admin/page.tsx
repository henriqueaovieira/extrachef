'use client';

import { useEffect, useState } from 'react';

interface StaffAccess {
  role: 'admin' | 'reviewer' | 'support';
  status: 'active';
}

export default function AdminPage() {
  const [access, setAccess] = useState<StaffAccess | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/staff/me', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível validar seu acesso administrativo.');
        return response.json() as Promise<StaffAccess>;
      })
      .then(setAccess)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : 'Não foi possível carregar seu acesso.');
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-stone-900">Admin Area</h1>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-stone-500">Role atual</dt>
            <dd className="font-medium text-stone-900">{access?.role ?? 'Carregando...'}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Status atual</dt>
            <dd className="font-medium text-stone-900">{access?.status ?? 'Carregando...'}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
