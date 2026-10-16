'use client';

import { Button } from '@/app/components/ui';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { decodeVapidKey, rememberPushChoice } from '@/lib/push-device';

type PushStatus = 'loading' | 'unsupported' | 'unconfigured' | 'ready' | 'error';

export default function PushNotificationControl() {
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<PushStatus>('loading');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [diagnostic, setDiagnostic] = useState('');
  const vapidPublicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let isMounted = true;

    async function checkSupport() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (token) {
        try {
          const response = await fetch('/api/push/status', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const statusData = await response.json() as {
            environment?: Record<string, boolean>;
            registeredDevices?: number;
            deliveries?: Array<{ status: string }>;
          };
          if (!response.ok) {
            if (isMounted) setDiagnostic(`Diagnóstico do servidor indisponível (HTTP ${response.status}).`);
          } else if (isMounted) {
            const missing = Object.entries(statusData.environment ?? {})
              .filter(([, configured]) => !configured)
              .map(([name]) => name);
            setDiagnostic(missing.length > 0
              ? `Configuração ausente no servidor: ${missing.join(', ')}.`
              : `${statusData.registeredDevices ?? 0} dispositivo(s) registrado(s). Últimas entregas: ${(statusData.deliveries ?? []).map((item) => item.status).slice(0, 5).join(', ') || 'nenhuma'}.`);
          }
        } catch {
          if (isMounted) setDiagnostic('Não foi possível consultar o status do Push no servidor.');
        }
      }

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
  }, [supabase, vapidPublicKey]);

  const updateSubscription = async () => {
    if (busy || !vapidPublicKey) return;
    setBusy(true);
    setMessage('');

    try {
      if (!enabled && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Permita notificações nas configurações do navegador.');
      }
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
        rememberPushChoice(sessionData.session!.user.id, false);
        setEnabled(false);
        setMessage('Notificações push desativadas neste dispositivo.');
      } else {
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
        rememberPushChoice(sessionData.session!.user.id, true);
        setEnabled(true);
        setMessage('Notificações push ativadas neste dispositivo.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível configurar notificações.');
    } finally {
      setBusy(false);
    }
  };

  const testPush = async () => {
    setBusy(true); setMessage('');
    try {
      const { data, error } = await supabase.rpc('request_push_test');
      if (error) throw new Error(error.message);
      setMessage(`Teste criado: ${data}. Minimize o app para testar o alerta do sistema e confira o diagnóstico após retornar.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível iniciar o teste.'); }
    finally { setBusy(false); }
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
        <Button
          type="button"
          onClick={() => void updateSubscription()}
          disabled={busy || status === 'loading' || status === 'error'}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
        >
          {status === 'loading' ? 'Verificando...' : busy ? 'Atualizando...' : enabled ? 'Desativar neste dispositivo' : 'Ativar neste dispositivo'}
        </Button>
      )}
      {message && <p role="status" className="text-sm text-gray-600">{message}</p>}
      {status === 'ready' && enabled && <Button type="button" disabled={busy} onClick={() => void testPush()} className="min-h-12 w-full">Enviar notificação de teste</Button>}
      {diagnostic && <p role="status" className="rounded-lg bg-gray-50 p-3 text-xs leading-5 text-gray-600">{diagnostic}</p>}
    </section>
  );
}