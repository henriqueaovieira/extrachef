import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChatMessage {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  read_at: string | null;
}

export interface MessagePreview extends ChatMessage {
  sender_name: string;
  photo_path: string | null;
  photo_bucket: string | null;
}

export interface CommunicationCounts {
  messages: number | null;
  notifications: number | null;
}

export function isIncomingUnread(message: ChatMessage, userId: string) {
  return message.sender_id !== userId && message.read_at === null;
}

export function isOpenConversation(pathname: string, jobId: string) {
  return pathname.replace(/\/$/, '') === `/chat/${jobId}`;
}

export async function readUnreadMessageCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase.from('messages')
    .select('id', { count: 'exact' })
    .neq('sender_id', userId).is('read_at', null).limit(1);
  if (error || count === null) {
    throw new Error('Não foi possível atualizar as mensagens não lidas.');
  }
  return count;
}

export async function readUnreadNotificationCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase.from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).neq('category', 'message').eq('read', false);
  if (error || count === null) {
    throw new Error('Não foi possível atualizar os indicadores de comunicação.');
  }
  return count;
}

export async function markChatRead(supabase: SupabaseClient, jobId: string, messageIds: string[]) {
  for (let offset = 0; offset < messageIds.length; offset += 1000) {
    const { error } = await supabase.rpc('mark_chat_messages_read', {
      p_job_id: jobId, p_message_ids: messageIds.slice(offset, offset + 1000),
    });
    if (error) throw new Error('Não foi possível registrar a leitura da conversa. Tente novamente.');
  }
}
