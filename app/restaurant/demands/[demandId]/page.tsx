import { Suspense } from 'react';
import { LoadingSkeleton } from '@/app/components/ui';
import DemandDetail from './demand-detail';

async function DemandContent({ params }: { params: Promise<{ demandId: string }> }) {
  const { demandId } = await params;
  return <DemandDetail demandId={demandId} />;
}

export default function DemandPage({ params }: { params: Promise<{ demandId: string }> }) {
  return (
    <Suspense fallback={<main className="p-5"><LoadingSkeleton label="Carregando operação..." /></main>}>
      <DemandContent params={params} />
    </Suspense>
  );
}
