import { Suspense } from 'react';
import CheckinClient from './checkin-client';

async function CheckinContent({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  return <CheckinClient jobId={jobId} />;
}

export default function CheckinPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50 p-8 text-center text-sm text-gray-500">Carregando check-in...</main>}>
      <CheckinContent params={params} />
    </Suspense>
  );
}