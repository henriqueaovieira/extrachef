import { Suspense } from 'react';
import { LoadingSkeleton } from '@/app/components/ui';
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
    <Suspense fallback={<main className="min-h-screen bg-gray-50 p-4"><LoadingSkeleton label="Carregando avaliação" /></main>}>
      <ReviewContent params={params} />
    </Suspense>
  );
}