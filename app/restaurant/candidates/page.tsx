'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LoadingSkeleton } from '@/app/components/ui';
import TalentCenter from '@/app/restaurant/candidates/talent-center';

function subscribeToHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

const getHash = () => window.location.hash;
const getServerHash = () => null;

export default function RestaurantCandidatesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hash = useSyncExternalStore(subscribeToHash, getHash, getServerHash);
  const legacyMessages = searchParams.get('view') === 'messages' || hash === '#chats';

  useEffect(() => {
    if (!legacyMessages || hash === null) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get('view') === 'messages') params.delete('view');
    const query = params.toString();
    router.replace(`/restaurant/messages${query ? `?${query}` : ''}${hash === '#chats' ? '' : hash}`);
  }, [hash, legacyMessages, router, searchParams]);

  if (hash === null || legacyMessages) return <main className="mx-auto max-w-2xl space-y-4 p-6">
    <LoadingSkeleton label={legacyMessages ? 'Abrindo mensagens...' : 'Carregando...'} />
    {legacyMessages && <Link href="/restaurant/messages" className="inline-flex min-h-12 items-center font-semibold text-orange-700">Abrir mensagens</Link>}
  </main>;

  return <TalentCenter initialDemandId={searchParams.get('demand')} />;
}
