import { Suspense } from 'react';
import ChatClient from './chat-client';

async function ChatContent({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  return <ChatClient jobId={jobId} />;
}

export default function ChatPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f4f5f2] p-8 text-center text-sm text-gray-500">Carregando conversa...</main>}>
      <ChatContent params={params} />
    </Suspense>
  );
}