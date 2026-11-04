'use client';

import { Button, EmptyState, LoadingSkeleton, TextArea, Toast } from '@/app/components/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import NotificationBell from '@/app/components/notification-bell';
import { useCommunication } from '@/app/components/communication-state';
import { Badge } from '@/app/components/ui';
import { loadDemandPeople, signDemandPhotos, type DemandPerson } from '@/lib/demand-detail';
import { readOperationalContext, type OperationalContext } from '@/lib/operations';
import OperationFlow from '@/app/components/operation-flow';
import ProfessionalVerification from '@/app/components/professional-verification';

interface ChatContext {
  job_title: string;
  current_user_role: 'restaurant' | 'worker';
  participant_name: string;
  participant_role: 'restaurant' | 'worker';
}

interface Message {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
}

interface RestaurantOperation {
  demand_id: string;
  worker_id: string;
  job_date: string;
  start_time: string;
  end_time: string;
  location: string;
  phase: string;
  specialty: string | null;
  rating: number | null;
  completed_operations: number | null;
  photoUrl: string | null;
}

interface OperationalTimelineEvent {
  id: string;
  kind: string;
  occurred_at: string;
}

type ChatTimelineItem =
  | { type: 'message'; id: string; created_at: string; message: Message }
  | { type: 'system'; id: string; created_at: string; label: string };

function sortMessages(messages: Message[]) {
  return [...messages].sort((first, second) => (
    new Date(first.created_at).getTime() - new Date(second.created_at).getTime()
  ));
}

function operationStatus(phase: string) {
  if (phase === 'unavailable') return 'Status indisponível';
  if (phase === 'confirmed') return 'Contratado';
  if (['checkin', 'absence_pending'].includes(phase)) return 'Check-in pendente';
  if (phase === 'working') return 'Em operação';
  if (['payment', 'receipt', 'payment_disputed'].includes(phase)) return 'Pagamento pendente';
  if (phase === 'checkout') return 'Checkout pendente';
  if (phase === 'completed') return 'Concluída';
  return 'Encerrada';
}

function operationStatusTone(status: string) {
  if (status === 'Em operação' || status === 'Concluída') return 'success';
  if (status.includes('pendente')) return 'warning';
  return 'neutral';
}

function formatOperationDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export default function ChatClient({ jobId }: { jobId: string }) {
  const [supabase] = useState(() => createClient());
  const [context, setContext] = useState<ChatContext | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [operation, setOperation] = useState<RestaurantOperation | null>(null);
  const [systemEvents, setSystemEvents] = useState<OperationalTimelineEvent[]>([]);
  const [operationError, setOperationError] = useState('');
  const [flowContext, setFlowContext] = useState<OperationalContext | null>(null);
  const [flowError, setFlowError] = useState('');
  const [flowNow, setFlowNow] = useState(() => new Date());
  const [currentUserId, setCurrentUserId] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [realtimeError, setRealtimeError] = useState('');
  const [readError, setReadError] = useState('');
  const [readRetry, setReadRetry] = useState(0);
  const { markRead, error: communicationError } = useCommunication();
  const bottomRef = useRef<HTMLDivElement>(null);
  const relationshipRef = useRef<string | null>(null);

  useEffect(() => {
    if (!context) return;
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const { data, error } = await supabase.rpc('operational_context', { p_job_id: jobId });
        if (error) throw new Error(error.message);
        const value = readOperationalContext(data);
        if (active && (['cancelled', 'absent', 'abandoned'].includes(value.phase)
          || (relationshipRef.current && value.assignment_id && relationshipRef.current !== value.assignment_id))) {
          setMessages([]); setContext(null);
          setErrorMessage('A contratação desta operação mudou. Reabra a conversa pelas suas operações.');
          return;
        }
        if (value.assignment_id) relationshipRef.current = value.assignment_id;
        if (active) { setFlowContext(value); setFlowNow(new Date()); setFlowError(''); }
      } catch (error) {
        if (active) {
          setFlowContext(null);
          setFlowError(error instanceof Error ? error.message : 'Não foi possível carregar as etapas da operação.');
        }
      } finally { refreshing = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [context, jobId, supabase]);

  useEffect(() => {
    let isMounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let historyVersion = 0;

    async function reloadHistory() {
      const version = ++historyVersion;
      const { data: history, error: historyError } = await supabase
        .from('messages')
        .select('id, job_id, sender_id, content, created_at, read_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });
      if (!isMounted || version !== historyVersion) return;
      if (historyError) {
        setErrorMessage('Não foi possível carregar as mensagens da conversa.');
        return;
      }
      setMessages((current) => {
        const messagesById = new Map<string, Message>();
        for (const message of [...((history ?? []) as Message[]), ...current]) {
          const previous = messagesById.get(message.id);
          messagesById.set(message.id, previous?.read_at && !message.read_at ? previous : message);
        }
        return sortMessages([...messagesById.values()]);
      });
    }

    async function loadChat() {
      try {
        setLoading(true);
        setContext(null);
        setMessages([]);
        setErrorMessage('');
        setReadError('');
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          throw new Error('Entre na sua conta para acessar o chat.');
        }

        if (!isMounted) return;
        setCurrentUserId(authData.user.id);

        const { data: contextData, error: contextError } = await supabase.rpc(
          'get_approved_chat_context',
          { p_job_id: jobId },
        );

        if (contextError) throw contextError;

        const chatContext = (Array.isArray(contextData) ? contextData[0] : contextData) as ChatContext | null;
        if (!chatContext) throw new Error('Chat indisponível para esta candidatura.');
        if (!isMounted) return;

        setContext(chatContext);
        setOperation(null);
        setSystemEvents([]);
        setOperationError('');
        if (chatContext.current_user_role === 'restaurant') {
          const [jobResult, applicationResult, operationResult, assignmentResult] = await Promise.all([
            supabase.from('jobs').select('demand_id, job_date, start_time, end_time, location_name, work_address, work_neighborhood, work_city, work_state').eq('id', jobId).maybeSingle(),
            supabase.from('applications').select('worker_id').eq('job_id', jobId).in('status', ['approved', 'in_progress', 'completed']).maybeSingle(),
            supabase.rpc('operational_context', { p_job_id: jobId }),
            supabase.from('operational_assignments').select('hired_at, checkin_at, paid_at, receipt_confirmed_at, payment_disputed_at, checkout_at, interruption, interrupted_at').eq('job_id', jobId).is('interruption', null).maybeSingle(),
          ]);
          if (jobResult.error || applicationResult.error) {
            if (isMounted) setOperationError('Não foi possível carregar o contexto da operação.');
          } else if (jobResult.data && applicationResult.data) {
            const job = jobResult.data;
            const workerId = applicationResult.data.worker_id;
            const operationContext = operationResult.error ? null : operationResult.data as OperationalContext | null;
            if (operationResult.error && isMounted) setOperationError('Não foi possível atualizar o status operacional.');
            const phase = operationContext?.phase ?? 'unavailable';
            const location = [job.location_name, job.work_address, job.work_neighborhood, [job.work_city, job.work_state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Local a definir';
            let person: DemandPerson | undefined;
            try {
              const people = await loadDemandPeople(supabase, job.demand_id, workerId, false);
              person = people[0];
              if (person) person = (await signDemandPhotos(supabase, [person]))[0];
            } catch (profileError) {
              if (isMounted) setOperationError(profileError instanceof Error
                ? `Não foi possível carregar o perfil do profissional: ${profileError.message}`
                : 'Não foi possível carregar o perfil do profissional.');
            }
            if (assignmentResult.error && isMounted) setOperationError('Não foi possível carregar a linha do tempo da operação.');
            const assignment = assignmentResult.data;
            const events: OperationalTimelineEvent[] = assignment ? [
              assignment.hired_at && { id: 'hired', kind: 'hired', occurred_at: assignment.hired_at },
              assignment.checkin_at && { id: 'checkin', kind: 'checkin', occurred_at: assignment.checkin_at },
              assignment.checkin_at && operationContext?.ends_at && new Date(operationContext.ends_at) <= new Date()
                && { id: 'work-ended', kind: 'work_ended', occurred_at: operationContext.ends_at },
              assignment.paid_at && { id: 'payment-reported', kind: 'payment_reported', occurred_at: assignment.paid_at },
              assignment.payment_disputed_at && { id: 'payment-disputed', kind: 'payment_disputed', occurred_at: assignment.payment_disputed_at },
              assignment.receipt_confirmed_at && { id: 'payment-confirmed', kind: 'payment_confirmed', occurred_at: assignment.receipt_confirmed_at },
              assignment.checkout_at && { id: 'checkout', kind: 'checkout', occurred_at: assignment.checkout_at },
              assignment.interruption && assignment.interrupted_at && {
                id: 'interruption',
                kind: assignment.interruption === 'absent' ? 'absent' : assignment.interruption === 'abandoned' ? 'abandoned' : 'worker_cancelled',
                occurred_at: assignment.interrupted_at,
              },
            ].filter((event): event is OperationalTimelineEvent => Boolean(event)) : [];
            if (isMounted) {
              setOperation({
                demand_id: job.demand_id,
                worker_id: workerId,
                job_date: job.job_date,
                start_time: job.start_time,
                end_time: job.end_time,
                location,
                phase,
                specialty: person?.specialties?.[0] ?? null,
                rating: person?.reputation?.average_rating ?? person?.score ?? null,
                completed_operations: person?.reputation?.completed ?? null,
                photoUrl: person?.photoUrl ?? null,
              });
              setSystemEvents(events);
            }
          } else if (isMounted) {
            setOperationError(operationResult.error?.message ?? 'O contexto da operação não está disponível.');
          }
        }
        channel = supabase
          .channel(`job-chat-${jobId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'messages',
              filter: `job_id=eq.${jobId}`,
            },
            (payload) => {
              if (!isMounted) return;
              if (payload.eventType === 'DELETE') {
                setMessages((current) => current.filter((message) => message.id !== payload.old.id));
                return;
              }
              const incomingMessage = payload.new as Message;
              setMessages((current) => {
                if (current.some((message) => message.id === incomingMessage.id)) {
                  return current.map((message) => message.id === incomingMessage.id ? incomingMessage : message);
                }
                return sortMessages([...current, incomingMessage]);
              });
            },
          )
          .subscribe((status) => {
            if (!isMounted) return;
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setRealtimeError('Conexão em tempo real interrompida. Tentando reconectar...');
            } else if (status === 'SUBSCRIBED') {
              setRealtimeError('');
              void reloadHistory();
            }
          });

        await reloadHistory();
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'Não foi possível abrir o chat.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadChat();

    return () => {
      isMounted = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [jobId, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    let active = true;
    let reading = false;
    const acknowledge = async () => {
      if (loading || !context || !currentUserId || reading || document.visibilityState !== 'visible') return;
      const ids = messages.filter((message) => message.job_id === jobId && message.sender_id !== currentUserId && message.read_at === null)
        .map((message) => message.id);
      if (!ids.length) return;
      reading = true;
      try {
        await markRead(jobId, ids);
        if (!active) return;
        const acknowledged = new Set(ids);
        setMessages((current) => current.map((message) => acknowledged.has(message.id)
          ? { ...message, read_at: new Date().toISOString() } : message));
        setReadError('');
      } catch (failure) {
        if (active) setReadError(failure instanceof Error ? failure.message : 'Não foi possível registrar a leitura.');
      } finally { reading = false; }
    };
    void acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    window.addEventListener('focus', acknowledge);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', acknowledge);
      window.removeEventListener('focus', acknowledge);
    };
  }, [messages, loading, context, currentUserId, markRead, jobId, readRetry]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !currentUserId || sending) return;

    setSending(true);
    setErrorMessage('');

    const { data, error } = await supabase
      .from('messages')
      .insert({ job_id: jobId, sender_id: currentUserId, content })
      .select('id, job_id, sender_id, content, created_at, read_at')
      .single();

    if (error) {
      setErrorMessage(error.message);
    } else {
      setDraft('');
      const sentMessage = data as Message;
      setMessages((current) => {
        if (current.some((message) => message.id === sentMessage.id)) return current;
        return sortMessages([...current, sentMessage]);
      });
    }

    setSending(false);
  };

  const backHref = context?.current_user_role === 'restaurant'
    ? '/restaurant/messages'
    : '/worker/applications';
  const restaurantChat = context?.current_user_role === 'restaurant';
  const operationalStatus = operation ? operationStatus(operation.phase) : 'Contratado';
  const operationalEvents: Record<string, string> = {
    hired: 'Profissional contratado.',
    checkin: 'Check-in realizado. Operação iniciada.',
    work_ended: 'Operação encerrada.',
    payment_reported: 'Pagamento informado.',
    payment_confirmed: 'Pagamento confirmado.',
    payment_disputed: 'Pagamento contestado.',
    checkout: 'Checkout concluído.',
    absent: 'Ausência confirmada.',
    abandoned: 'Abandono registrado.',
    worker_cancelled: 'Profissional cancelou a operação.',
  };
  const timeline: ChatTimelineItem[] = [
    ...messages.map((message): ChatTimelineItem => ({ type: 'message', id: message.id, created_at: message.created_at, message })),
    ...systemEvents.flatMap((event): ChatTimelineItem[] => {
      const label = operationalEvents[event.kind];
      return label ? [{ type: 'system', id: event.id, created_at: event.occurred_at, label }] : [];
    }),
  ].sort((first, second) => new Date(first.created_at).getTime() - new Date(second.created_at).getTime());

  return (
    <main className={`min-h-dvh bg-[#f4f5f2] px-3 pt-3 sm:px-6 sm:pt-6 ${restaurantChat ? 'pb-24' : 'pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:pb-8'}`}>
      <section className={`mx-auto flex min-h-80 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm ${restaurantChat ? 'h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] max-w-5xl sm:h-[calc(100dvh-7rem)]' : 'h-[calc(100dvh-6rem-env(safe-area-inset-bottom))] max-w-4xl sm:h-[calc(100dvh-4rem)]'}`}>
        {restaurantChat ? <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 sm:px-6">
          <Link
            href={backHref}
            aria-label="Voltar"
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-lg text-gray-600 transition hover:bg-gray-50"
          >
            ←
          </Link>
          {operation?.photoUrl && <span className="relative size-11 shrink-0 overflow-hidden rounded-full bg-orange-50">
            <Image src={operation.photoUrl} alt="" fill unoptimized sizes="44px" className="object-cover" />
          </span>}
          <div className="min-w-0">
            <h1 className="flex items-center font-semibold text-gray-900"><span className="truncate">{context?.participant_name ?? 'Conversa'}</span>{context?.participant_role === 'worker' && <ProfessionalVerification jobId={jobId} />}</h1>
            <p className="truncate text-xs text-gray-500">
              {operation?.specialty ?? 'Profissional'}
              {operation?.rating !== null && operation?.rating !== undefined ? ` · ★ ${Number(operation.rating).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}` : ''}
              {operation?.completed_operations !== null && operation?.completed_operations !== undefined ? ` · ${operation.completed_operations} operações concluídas` : ''}
            </p>
          </div>
        </header> : <header className="flex items-center gap-4 border-b border-gray-200 px-4 py-4 sm:px-6">
          <Link href={backHref} aria-label="Voltar" className="flex size-12 shrink-0 items-center justify-center rounded-full border border-gray-200 text-lg text-gray-600 transition hover:bg-gray-50">←</Link>
          <div className="min-w-0">
            <h1 className="flex items-center font-semibold text-gray-900"><span className="truncate">{context?.participant_name ?? 'Conversa'}</span>{context?.participant_role === 'worker' && <ProfessionalVerification jobId={jobId} />}</h1>
            <p className="truncate text-sm text-gray-500">{loading ? 'Carregando conversa...' : context?.job_title ?? 'Chat do plantão'}</p>
          </div>
          {context && <span className="ml-auto hidden rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800 sm:inline-flex">{context.participant_role === 'restaurant' ? 'Restaurante' : 'Trabalhador'}</span>}
          <div className="hidden md:block"><NotificationBell /></div>
        </header>}

        {restaurantChat && <section aria-label="Contexto da operação" className="space-y-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="font-semibold text-gray-900">{operation ? context?.job_title : 'Carregando operação...'}</h2>
                {operation && <p className="mt-1 text-xs text-gray-600">{formatOperationDate(operation.job_date)} · {operation.start_time.slice(0, 5)} às {operation.end_time.slice(0, 5)}</p>}
              </div>
              <Badge tone={operationStatusTone(operationalStatus)}>{operationalStatus}</Badge>
            </div>
            {operation && <p className="mt-2 text-xs text-gray-600">{operation.location}</p>}
            {operationError && <p role="status" className="mt-2 text-xs text-amber-800">{operationError}</p>}
          </div>
          {operation && <div className="flex flex-wrap gap-2">
            <Link href={`/restaurant/demands/${operation.demand_id}?view=profile&person=${operation.worker_id}`} className="ec-button ec-button--secondary min-h-10 px-3 text-xs">Ver Perfil</Link>
            <Link href={`/restaurant/demands/${operation.demand_id}`} className="ec-button ec-button--secondary min-h-10 px-3 text-xs">Ver Operação</Link>
          </div>}
        </section>}

        {context && <div className="border-b border-gray-200 px-4 py-3 sm:px-6">
          {flowContext ? <OperationFlow jobId={jobId} role={flowContext.role} hired assignment={flowContext}
            startsAt={new Date(flowContext.starts_at)} endsAt={new Date(flowContext.ends_at)} now={flowNow} phase={flowContext.phase} showChat={false} />
            : <p role="status" className="text-sm text-gray-600">{flowError || 'Carregando etapas da operação...'}</p>}
        </div>}

        <div className="flex-1 space-y-4 overflow-y-auto bg-[#f8f9f7] px-4 py-5 sm:px-6">
          {loading ? (
            <LoadingSkeleton label="Carregando mensagens..." />
          ) : errorMessage && !context ? (
            <div role="alert" className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-5 text-center text-sm text-red-700">
              {errorMessage}
            </div>
          ) : restaurantChat && timeline.length === 0 ? (
            <EmptyState icon="↗" title="Conversa da operação" description="Combine os detalhes do turno com o profissional contratado." />
          ) : !restaurantChat && messages.length === 0 ? (
            <EmptyState icon="↗" title="Comece a conversa" description="Combine os detalhes do plantão. Escreva sua primeira mensagem abaixo." />
          ) : restaurantChat ? (
            timeline.map((item) => item.type === 'system' ? <div key={item.id} className="flex justify-center">
              <p className="max-w-[90%] rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-center text-xs font-medium text-blue-900">
                <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">Sistema</span>{item.label}
                <time className="ml-2 text-[10px] font-normal text-blue-700">{new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
              </p>
            </div> : (() => {
              const message = item.message;
              const isOwnMessage = message.sender_id === currentUserId;
              return <article key={item.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[85%] flex-col gap-1 sm:max-w-[72%] ${isOwnMessage ? 'items-end' : 'items-start'}`}>
                  <span className="flex items-center px-1 text-xs text-gray-500">{isOwnMessage ? 'Você' : context?.participant_name}<ProfessionalVerification userId={message.sender_id} /></span>
                  <div className={`rounded-2xl px-4 py-3 ${isOwnMessage ? 'rounded-br-sm bg-orange-700 text-white' : 'rounded-bl-sm border border-gray-200 bg-white text-gray-800'}`}>
                    <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                  </div>
                  <time className="px-1 text-[11px] text-gray-400">{new Date(message.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              </article>;
            })())
          ) : (
            messages.map((message) => {
              const isOwnMessage = message.sender_id === currentUserId;

              return (
                <article
                  key={message.id}
                  className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] sm:max-w-[72%] ${isOwnMessage ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                    <span className="px-1 text-xs text-gray-500">
                      {isOwnMessage ? 'Você' : context?.participant_name}
                      <ProfessionalVerification userId={message.sender_id} />
                    </span>
                    <div className={`rounded-2xl px-4 py-3 ${isOwnMessage ? 'rounded-br-sm bg-emerald-700 text-white' : 'rounded-bl-sm border border-gray-200 bg-white text-gray-800'}`}>
                      <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                    </div>
                    <time className="px-1 text-[11px] text-gray-400">
                      {new Date(message.created_at).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </article>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {realtimeError && (
          <p role="status" className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-800">
            {realtimeError}
          </p>
        )}
        {errorMessage && context && (
          <Toast tone="error">{errorMessage}</Toast>
        )}
        {communicationError && <Toast tone="error">{communicationError}</Toast>}
        {readError && <Toast tone="error">{readError}<Button onClick={() => setReadRetry((current) => current + 1)}>Tentar registrar leitura novamente</Button></Toast>}

        <form onSubmit={sendMessage} className="flex items-end gap-3 border-t border-gray-200 bg-white p-3 sm:p-4">
          <label htmlFor="chat-message" className="sr-only">Mensagem</label>
          <TextArea
            id="chat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={4000}
            autoComplete="off"
            enterKeyHint="send"
            rows={1}
            placeholder="Escreva uma mensagem..."
            disabled={!context || loading || sending}
            className="max-h-32 flex-1 resize-y"
          />
          <Button variant="primary"
            type="submit"
            busy={sending}
            disabled={!context || loading || sending || !draft.trim()}
            className="inline-flex shrink-0 items-center justify-center px-5 text-base"
          >
            {sending ? 'Enviando...' : 'Enviar'}
          </Button>
        </form>
      </section>
      {context && <MobileBottomNav role={context.current_user_role} showOnDesktop={restaurantChat} />}
    </main>
  );
}