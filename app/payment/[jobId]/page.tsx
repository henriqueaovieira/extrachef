import { Suspense } from 'react';
import { LoadingSkeleton } from '@/app/components/ui';
import OperationalPanel from '@/app/components/operational-panel';

async function PaymentContent({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <OperationalPanel jobId={jobId} />;
}

export default function PaymentPage({ params }: { params: Promise<{ jobId: string }> }) {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gray-50 p-4"><LoadingSkeleton label="Carregando pagamento..." /></main>}>
      <PaymentContent params={params} />
    </Suspense>
  );
}
