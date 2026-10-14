'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type PushStatus = 'loading' | 'unsupported' | 'unconfigured' | 'ready' | 'error';

function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export default function PushNotificationControl() {
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<PushStatus>('loading');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const vapidPublicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let isMounted = true;

    async function checkSupport() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (isMounted) setStatus('unsupported');
        return;
      }
      if (!vapidPublicKey) {
        if (isMounted) setStatus('unconfigured');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration('/');
        if (!registration) {
          if (isMounted) setStatus('unconfigured');
          return;
        }
        const subscription = await registration?.pushManager.getSubscription();
        if (isMounted) {
          setEnabled(Boolean(subscription));
          setStatus('ready');
        }
      } catch {
        if (isMounted) setStatus('error');
      }
    }

    void checkSupport();
    return () => {
      isMounted = false;
    };
  }, [vapidPublicKey]);

  const updateSubscription = async () => {
    if (busy || !vapidPublicKey) return;
    setBusy(true);
    setMessage('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Entre novamente para configurar notificações.');

      const registration = await navigator.serviceWorker.ready;
      const existingSubscription = await registration.pushManager.getSubscription();

      if (existingSubscription) {
        const response = await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existingSubscription.endpoint }),
        });
        if (!response.ok) throw new Error('Não foi possível remover a inscrição de notificações.');
        await existingSubscription.unsubscribe();
        setEnabled(false);
        setMessage('Notificações push desativadas neste dispositivo.');
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Permita notificações nas configurações do navegador.');
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(vapidPublicKey),
        });
        const response = await fetch('/api/push/subscriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        });
        if (!response.ok) {
          await subscription.unsubscribe();
          throw new Error('Não foi possível salvar a inscrição de notificações.');
        }
        setEnabled(true);
        setMessage('Notificações push ativadas neste dispositivo.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível configurar notificações.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="font-semibold text-gray-900">Notificações push</h2>
        <p className="mt-1 text-sm leading-5 text-gray-600">Receba avisos de aprovações, mensagens, presença e avaliações neste dispositivo.</p>
      </div>
      {status === 'unsupported' ? (
        <p className="text-sm text-gray-500">Este navegador não oferece notificações push.</p>
      ) : status === 'unconfigured' ? (
        <p className="text-sm text-gray-500">Instale o ExtraChef e configure Web Push neste ambiente para ativar notificações.</p>
      ) : (
        <button
          type="button"
          onClick={() => void updateSubscription()}
          disabled={busy || status === 'loading' || status === 'error'}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
        >
          {status === 'loading' ? 'Verificando...' : busy ? 'Atualizando...' : enabled ? 'Desativar neste dispositivo' : 'Ativar neste dispositivo'}
        </button>
      )}
      {message && <p role="status" className="text-sm text-gray-600">{message}</p>}
    </section>
  );
}