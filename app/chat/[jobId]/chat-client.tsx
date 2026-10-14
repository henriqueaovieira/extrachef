'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';

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
}

function sortMessages(messages: Message[]) {
  return [...messages].sort((first, second) => (
    new Date(first.created_at).getTime() - new Date(second.created_at).getTime()
  ));
}

export default function ChatClient({ jobId }: { jobId: string }) {
  const [supabase] = useState(() => createClient());
  const [context, setContext] = useState<ChatContext | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [realtimeError, setRealtimeError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function loadChat() {
      try {
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
        channel = supabase
          .channel(`job-chat-${jobId}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'messages',
              filter: `job_id=eq.${jobId}`,
            },
            (payload) => {
              const incomingMessage = payload.new as Message;
              setMessages((current) => {
                if (current.some((message) => message.id === incomingMessage.id)) return current;
                return sortMessages([...current, incomingMessage]);
              });
            },
          )
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setRealtimeError('Conexão em tempo real interrompida. Tentando reconectar...');
            } else if (status === 'SUBSCRIBED') {
              setRealtimeError('');
            }
          });

        const { data: history, error: historyError } = await supabase
          .from('messages')
          .select('id, job_id, sender_id, content, created_at')
          .eq('job_id', jobId)
          .order('created_at', { ascending: true });

        if (historyError) throw historyError;
        if (!isMounted) return;

        setMessages((current) => {
          const messagesById = new Map<string, Message>();
          for (const message of [...((history ?? []) as Message[]), ...current]) {
            messagesById.set(message.id, message);
          }
          return sortMessages([...messagesById.values()]);
        });
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

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !currentUserId || sending) return;

    setSending(true);
    setErrorMessage('');

    const { data, error } = await supabase
      .from('messages')
      .insert({ job_id: jobId, sender_id: currentUserId, content })
      .select('id, job_id, sender_id, content, created_at')
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
    ? '/restaurant/candidates'
    : '/worker/applications';

  return (
    <main className="min-h-dvh bg-[#f4f5f2] px-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-8 sm:pb-8">
      <section className="mx-auto flex h-[calc(100dvh-6rem-env(safe-area-inset-bottom))] min-h-80 max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm sm:h-[calc(100dvh-4rem)]">
        <header className="flex items-center gap-4 border-b border-gray-200 px-4 py-4 sm:px-6">
          <Link
            href={backHref}
            aria-label="Voltar"
            className="flex size-12 shrink-0 items-center justify-center rounded-full border border-gray-200 text-lg text-gray-600 transition hover:bg-gray-50"
          >
            ←
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-gray-900">
              {context?.participant_name ?? 'Conversa'}
            </h1>
            <p className="truncate text-sm text-gray-500">
              {loading ? 'Carregando conversa...' : context?.job_title ?? 'Chat do plantão'}
            </p>
          </div>
          {context && (
            <span className="ml-auto hidden rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-800 sm:inline-flex">
              {context.participant_role === 'restaurant' ? 'Restaurante' : 'Trabalhador'}
            </span>
          )}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto bg-[#f8f9f7] px-4 py-5 sm:px-6">
          {loading ? (
            <p className="py-10 text-center text-sm text-gray-500">Carregando mensagens...</p>
          ) : errorMessage && !context ? (
            <div role="alert" className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-5 text-center text-sm text-red-700">
              {errorMessage}
            </div>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">Esta conversa ainda não tem mensagens.</p>
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
          <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        )}

        <form onSubmit={sendMessage} className="flex items-end gap-3 border-t border-gray-200 bg-white p-3 sm:p-4">
          <label htmlFor="chat-message" className="sr-only">Mensagem</label>
          <textarea
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
            rows={1}
            placeholder="Escreva uma mensagem..."
            disabled={!context || loading || sending}
            className="max-h-32 min-h-12 flex-1 resize-y rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50"
          />
          <button
            type="submit"
            disabled={!context || loading || sending || !draft.trim()}
            className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-emerald-700 px-5 text-base font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Enviando...' : 'Enviar'}
          </button>
        </form>
      </section>
      {context && <MobileBottomNav role={context.current_user_role} />}
    </main>
  );
}