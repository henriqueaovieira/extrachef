'use client';

import OperationalPanel from '@/app/components/operational-panel';

export default function CheckinClient({ jobId }: { jobId: string }) {
  return <OperationalPanel jobId={jobId} />;
}
