import { Suspense } from 'react';
import { LoadingSkeleton } from '@/app/components/ui';
import CheckoutClient from './checkout-client';

async function CheckoutContent({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  return <CheckoutClient jobId={jobId} />;
}

export default function CheckoutPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50 p-4"><LoadingSkeleton label="Carregando finalização" /></main>}>
      <CheckoutContent params={params} />
    </Suspense>
  );
}