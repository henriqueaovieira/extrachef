import { Suspense } from 'react';
import ReviewClient from './review-client';

async function ReviewContent({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  return <ReviewClient jobId={jobId} />;
}

export default function ReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50 p-8 text-center text-sm text-gray-500">Carregando avaliação...</main>}>
      <ReviewContent params={params} />
    </Suspense>
  );
}