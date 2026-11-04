'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LoadingSkeleton } from '@/app/components/ui';

export default function WorkerProfileRedirect({ edit = false }: { edit?: boolean }) {
  const router = useRouter();
  const href = edit ? '/worker/profile?edit=1' : '/worker/profile';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (edit) params.set('edit', '1');
    const query = params.toString();
    router.replace(`/worker/profile${query ? `?${query}` : ''}${window.location.hash}`);
  }, [edit, router]);

  return <main className="mx-auto max-w-2xl space-y-4 p-6">
    <LoadingSkeleton label="Abrindo seu perfil..." />
    <Link href={href} className="inline-flex min-h-12 items-center font-semibold text-orange-700">Abrir meu perfil</Link>
  </main>;
}
