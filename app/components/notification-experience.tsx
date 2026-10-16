'use client';

import { Button, TextInput, Toast } from '@/app/components/ui';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CommunicationContext } from '@/app/components/communication-state';
import { reconcileDeviceSubscription } from '@/lib/push-device';
import {
  isIncomingUnread, isOpenConversation, markChatRead, readUnreadMessageCount, readUnreadNotificationCount,
  type ChatMessage, type CommunicationCounts, type MessagePreview,
} from '@/lib/communication';

interface FloatingMessage extends MessagePreview {
  imageUrl: string | null;
}

const emptyCounts: CommunicationCounts = { messages: null, notifications: null };

export default function NotificationExperience({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient());
  const pathname = usePathname();
  const [counts, setCounts] = useState<CommunicationCounts>(emptyCounts);
  const [error, setError] = useState('');
  const [countError, setCountError] = useState('');
  const [chatError, setChatError] = useState('');
  const [floatingMessage, setFloatingMessage] = useState<FloatingMessage | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string; jobId: string } | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');
  const userIdRef = useRef('');
  const pathRef = useRef(pathname);
  const floatingRef = useRef<FloatingMessage | null>(null);
  const messagesEnabled = useRef(true);
  const seen = useRef(new Set<string>());
  const generation = useRef(0);
  const refreshVersion = useRef(0);
  const previewVersion = useRef(0);
  const pendingPreview = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const realtimeReady = useRef(false);
  const invalidatePending = useCallback(() => {
    generation.current++;
    refreshVersion.current++;
    previewVersion.current++;
  }, []);

  const dismiss = useCallback((jobId?: string) => {
    previewVersion.current++;
    pendingPreview.current = '';
    if (!jobId || floatingRef.current?.job_id === jobId) {
      floatingRef.current = null;
      setFloatingMessage(null);
      setReply('');
      setReplyError('');
    }
    setToast((current) => !jobId || current?.jobId === jobId ? null : current);
  }, []);

  useEffect(() => {
    pathRef.current = pathname;
    const current = floatingRef.current;
    if (current && isOpenConversation(pathname, current.job_id)) dismiss(current.job_id);
  }, [pathname, dismiss]);

  const refresh = useCallback(async () => {
    const userId = userIdRef.current;
    const version = ++refreshVersion.current;
    if (!userId) return;
    const isCurrent = () => mountedRef.current && userIdRef.current === userId && version === refreshVersion.current;
    const refreshMessages = async () => {
      try {
        const messages = await readUnreadMessageCount(supabase, userId);
        if (isCurrent()) {
          setCounts((current) => ({ ...current, messages }));
          setChatError('');
        }
      } catch (failure) {
        if (isCurrent()) {
          setCounts((current) => ({ ...current, messages: null }));
          setChatError(failure instanceof Error ? failure.message : 'Não foi possível atualizar as mensagens não lidas.');
        }
      }
    };
    const refreshNotifications = async () => {
      if (!realtimeReady.current) return;
      try {
        const notifications = await readUnreadNotificationCount(supabase, userId);
        if (isCurrent()) {
          setCounts((current) => ({ ...current, notifications }));
          setCountError('');
        }
      } catch (failure) {
        if (isCurrent()) {
          setCounts((current) => ({ ...current, notifications: null }));
          setCountError(failure instanceof Error ? failure.message : 'Não foi possível atualizar os indicadores.');
        }
      }
    };
    await Promise.all([refreshMessages(), refreshNotifications()]);
  }, [supabase]);

  const markRead = useCallback(async (jobId: string, messageIds: string[]) => {
    const userId = userIdRef.current;
    await markChatRead(supabase, jobId, messageIds);
    if (userIdRef.current !== userId || !mountedRef.current) return;
    // Only dismiss a preview acknowledged by this operation, not a newer arrival.
    if (floatingRef.current?.job_id === jobId && messageIds.includes(floatingRef.current.id)) dismiss(jobId);
    await refresh();
  }, [supabase, dismiss, refresh]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const report = (message: string) => {
      if (active) setError(message);
    };
    const syncSubscription = async () => {
      if (!process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY || !('serviceWorker' in navigator)) return;
      const owner = userIdRef.current;
      try {
        const subscription = await reconcileDeviceSubscription(owner, process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY);
        if (!subscription || !owner) return;
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session || data.session.user.id !== owner || userIdRef.current !== owner) return;
        const response = await fetch('/api/push/subscriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        });
        if (!response.ok) throw new Error('subscription_sync_failed');
      } catch {
        report('Não foi possível sincronizar as notificações Push deste dispositivo.');
      }
    };

    const verifyPreview = async () => {
      const current = floatingRef.current;
      if (!current) return;
      const { data, error: readError } = await supabase.from('messages')
        .select('id, read_at').eq('id', current.id).maybeSingle();
      if (!active || floatingRef.current?.id !== current.id) return;
      if (readError) {
        dismiss();
        report('Não foi possível verificar a leitura da mensagem.');
      } else if (!data || data.read_at !== null) dismiss(current.job_id);
    };

    const receive = async (message: ChatMessage) => {
      const owner = userIdRef.current;
      if (!active || !owner || !isIncomingUnread(message, owner)
        || document.visibilityState !== 'visible' || !messagesEnabled.current
        || isOpenConversation(pathRef.current, message.job_id) || seen.current.has(message.id)) return;
      seen.current.add(message.id);
      const oldest = seen.current.values().next().value;
      if (seen.current.size > 500 && oldest) seen.current.delete(oldest);
      const version = ++previewVersion.current;
      pendingPreview.current = message.id;
      const { data, error: previewError } = await supabase.rpc('get_chat_message_preview', { p_message_id: message.id });
      if (!active || owner !== userIdRef.current || version !== previewVersion.current) return;
      if (previewError) {
        seen.current.delete(message.id);
        report('Não foi possível carregar a prévia da nova mensagem.');
        return;
      }
      const preview = (Array.isArray(data) ? data[0] : data) as MessagePreview | null;
      if (!preview || !isIncomingUnread(preview, owner)) return;
      let imageUrl: string | null = null;
      if (preview.photo_path && preview.photo_bucket) {
        if (preview.photo_bucket === 'restaurant-assets' || preview.photo_bucket === 'worker-private') {
          const result = await supabase.storage.from(preview.photo_bucket).createSignedUrl(preview.photo_path, 300);
          if (!result.error) imageUrl = result.data.signedUrl;
        }
      }
      if (!active || owner !== userIdRef.current || version !== previewVersion.current
        || document.visibilityState !== 'visible' || !messagesEnabled.current
        || isOpenConversation(pathRef.current, preview.job_id)) return;
      const receipt = await supabase.from('messages').select('id, read_at').eq('id', preview.id).maybeSingle();
      if (!active || owner !== userIdRef.current || version !== previewVersion.current
        || document.visibilityState !== 'visible' || !messagesEnabled.current
        || isOpenConversation(pathRef.current, preview.job_id)) return;
      if (receipt.error) { report('Não foi possível verificar a leitura da nova mensagem.'); return; }
      if (!receipt.data || receipt.data.read_at !== null) return;
      pendingPreview.current = '';
      const next = { ...preview, imageUrl };
      const sameConversation = floatingRef.current?.job_id === next.job_id;
      floatingRef.current = next;
      setFloatingMessage(next);
      if (!sameConversation) {
        setReply('');
        setReplyError('');
      }
      setToast({ title: `Nova mensagem · ${preview.sender_name}`, body: preview.content, jobId: preview.job_id });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 7000);
    };

    async function initialize(userId: string) {
      if (!active || userIdRef.current === userId) return;
      const currentGeneration = ++generation.current;
      if (channel) void supabase.removeChannel(channel);
      userIdRef.current = userId;
      realtimeReady.current = false;
      seen.current.clear();
      messagesEnabled.current = true;
      setCounts(emptyCounts);
      setError('');
      setCountError('');
      setChatError('');
      setSending(false);
      dismiss();
      void refresh();
      const { data: preferences, error: preferenceError } = await supabase.from('notification_preferences')
        .select('messages_enabled').eq('user_id', userId).maybeSingle();
      if (!active || generation.current !== currentGeneration) return;
      if (preferenceError) {
        messagesEnabled.current = false;
        report('Não foi possível carregar suas preferências de mensagens.');
      } else messagesEnabled.current = preferences?.messages_enabled ?? true;

      channel = supabase.channel(`communication-${userId}-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
          if (!active || generation.current !== currentGeneration) return;
          void refresh();
          if (payload.eventType === 'INSERT') void receive(payload.new as ChatMessage);
          else if (payload.eventType === 'UPDATE') {
            const message = payload.new as ChatMessage;
            if (message.read_at && (floatingRef.current?.id === message.id || pendingPreview.current === message.id)) dismiss(message.job_id);
          } else {
            if (pendingPreview.current === payload.old.id) dismiss();
            void verifyPreview();
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
          if (active && generation.current === currentGeneration) void refresh();
        })
        .subscribe((status) => {
          if (!active || generation.current !== currentGeneration) return;
          if (status === 'SUBSCRIBED') {
            realtimeReady.current = true;
            void refresh();
            void verifyPreview();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            refreshVersion.current++;
            realtimeReady.current = false;
            setCounts(emptyCounts);
            setChatError('Conexão em tempo real indisponível. Atualize o indicador do Chat ao reconectar.');
            dismiss();
            setCountError('Conexão em tempo real indisponível. Os indicadores serão atualizados ao reconectar.');
          }
        });
      void refresh();
      void syncSubscription();
    }

    const initialGeneration = generation.current;
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (active && generation.current === initialGeneration && !authError && data.user) void initialize(data.user.id);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        invalidatePending();
        userIdRef.current = '';
        realtimeReady.current = false;
        setCounts(emptyCounts);
        setError('');
        setCountError('');
        setChatError('');
        setSending(false);
        dismiss();
        if (channel) void supabase.removeChannel(channel);
        channel = null;
      } else window.setTimeout(() => { if (active) void initialize(session.user.id); }, 0);
    });
    const foreground = () => {
      if (document.visibilityState !== 'visible') { dismiss(); return; }
      if (userIdRef.current) { void refresh(); void verifyPreview(); void syncSubscription(); }
    };
    const preferencesUpdated = (event: Event) => {
      messagesEnabled.current = Boolean((event as CustomEvent<{ messages_enabled: boolean }>).detail.messages_enabled);
      if (!messagesEnabled.current) dismiss();
    };
    const serviceWorkerMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') { void syncSubscription(); return; }
      if (event.data?.type !== 'PUSH_RECEIVED' || !userIdRef.current) return;
      void refresh();
      const payload = event.data.payload as { notificationId?: string; category?: string };
      if (payload?.category !== 'message' || !payload.notificationId) return;
      const owner = userIdRef.current;
      const { data, error: notificationError } = await supabase.from('notifications')
        .select('message_id').eq('id', payload.notificationId).eq('user_id', owner)
        .eq('category', 'message').maybeSingle();
      if (!active || owner !== userIdRef.current) return;
      if (notificationError) { report('Não foi possível consultar a mensagem recebida por Push.'); return; }
      if (!data?.message_id) return;
      const result = await supabase.from('messages').select('id, job_id, sender_id, content, read_at')
        .eq('id', data.message_id).maybeSingle();
      if (!active || owner !== userIdRef.current) return;
      if (result.error) report('Não foi possível consultar a mensagem recebida por Push.');
      else if (result.data) void receive(result.data as ChatMessage);
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('focus', foreground);
    window.addEventListener('extrachef:preferences-updated', preferencesUpdated);
    navigator.serviceWorker?.addEventListener('message', serviceWorkerMessage);
    const onControllerChange = () => { if (userIdRef.current) void syncSubscription(); };
    navigator.serviceWorker?.addEventListener('controllerchange', onControllerChange);
    return () => {
      active = false;
      mountedRef.current = false;
      userIdRef.current = '';
      realtimeReady.current = false;
      invalidatePending();
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('focus', foreground);
      window.removeEventListener('extrachef:preferences-updated', preferencesUpdated);
      navigator.serviceWorker?.removeEventListener('message', serviceWorkerMessage);
      navigator.serviceWorker?.removeEventListener('controllerchange', onControllerChange);
      authListener.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [dismiss, refresh, supabase, invalidatePending]);

  const sendQuickReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = floatingRef.current;
    const owner = userIdRef.current;
    const requestGeneration = generation.current;
    const content = reply.trim();
    if (!content || !target || !owner || sending || content.length > 4000) return;
    setSending(true);
    setReplyError('');
    try {
      const { error: sendError } = await supabase.from('messages')
        .insert({ job_id: target.job_id, sender_id: owner, content });
      if (!mountedRef.current || owner !== userIdRef.current || requestGeneration !== generation.current) return;
      if (sendError) throw new Error('Não foi possível enviar sua resposta. Tente novamente.');
      // Do not resend a successful reply if recording its read receipt fails.
      if (floatingRef.current?.id === target.id) dismiss(target.job_id);
      try { await markRead(target.job_id, [target.id]); }
      catch (failure) {
        if (mountedRef.current && owner === userIdRef.current && requestGeneration === generation.current) {
          setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a leitura.');
        }
      }
    } catch (failure) {
      if (mountedRef.current && owner === userIdRef.current && requestGeneration === generation.current) {
        setReplyError(failure instanceof Error ? failure.message : 'Não foi possível enviar sua resposta.');
      }
    } finally {
      if (mountedRef.current && requestGeneration === generation.current) setSending(false);
    }
  };

  const showMessage = floatingMessage && !isOpenConversation(pathname, floatingMessage.job_id);
  return (
    <CommunicationContext.Provider value={{ counts, error: countError, chatError, refresh, markRead }}>
      {error && <div className="mx-auto w-full max-w-3xl px-4 pt-3"><Toast tone="error" onDismiss={() => setError('')}>{error}</Toast></div>}
      {children}
      {toast && !isOpenConversation(pathname, toast.jobId) && (
        <aside className="ec-notification-toast fixed left-3 right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 mx-auto max-w-sm shadow-xl md:left-auto md:top-[calc(5rem+env(safe-area-inset-top))]">
          <Toast tone="info" title={toast.title} onDismiss={() => setToast(null)}>
            <p className="line-clamp-2">{toast.body}</p>
            <Link href={`/chat/${toast.jobId}`} onClick={() => dismiss(toast.jobId)} className="mt-2 inline-flex min-h-11 items-center font-semibold underline">Abrir conversa</Link>
          </Toast>
        </aside>
      )}
      {showMessage && (
        <aside aria-label="Nova mensagem" className="ec-floating-message fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-3 z-40 max-h-[55dvh] w-[min(23rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl sm:left-auto sm:right-3 md:bottom-5">
          <div className="flex items-start gap-3">
            {floatingMessage.imageUrl
              ? <Image src={floatingMessage.imageUrl} alt={`Foto de ${floatingMessage.sender_name}`} width={44} height={44} unoptimized className="size-11 shrink-0 rounded-full object-cover" />
              : <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-orange-100 font-bold text-orange-800">{floatingMessage.sender_name.trim().charAt(0).toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-gray-950">{floatingMessage.sender_name}</p>
              <p className="mt-2 line-clamp-2 text-sm text-gray-700">{floatingMessage.content}</p>
            </div>
            <Button variant="ghost" aria-label="Fechar mensagem" onClick={() => dismiss(floatingMessage.job_id)}>×</Button>
          </div>
          <form onSubmit={(event) => void sendQuickReply(event)} className="mt-3 flex gap-2">
            <TextInput value={reply} onChange={(event) => setReply(event.target.value)} maxLength={4000}
              disabled={sending} autoComplete="off" enterKeyHint="send" placeholder="Responder..."
              aria-label="Resposta rápida" className="min-w-0 flex-1" />
            <Button variant="primary" type="submit" busy={sending} disabled={!reply.trim() || sending}>Enviar</Button>
          </form>
          {replyError && <Toast tone="error">{replyError}</Toast>}
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href={`/chat/${floatingMessage.job_id}`} onClick={() => dismiss(floatingMessage.job_id)} className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-700">Abrir conversa</Link>
            <Button variant="ghost" disabled={sending} onClick={() => {
              void markRead(floatingMessage.job_id, [floatingMessage.id])
                .catch((failure: unknown) => setReplyError(failure instanceof Error ? failure.message : 'Falha ao registrar leitura.'));
            }}>Marcar como lida</Button>
          </div>
        </aside>
      )}
    </CommunicationContext.Provider>
  );
}
