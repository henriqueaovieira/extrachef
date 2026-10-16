'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Toast } from '@/app/components/ui';

export default function RouteFeedback() {
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  return params.get('feedback') === 'job_created' && !dismissed
    ? <Toast tone="success" onDismiss={() => {
      setDismissed(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('feedback');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }}>Vaga criada com sucesso.</Toast>
    : null;
}
