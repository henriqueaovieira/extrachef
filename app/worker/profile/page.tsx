import { Suspense } from 'react';
import { LoadingSkeleton } from '@/app/components/ui';
import WorkerProfileExperience from '@/app/components/worker-profile-experience';

export default function WorkerProfilePage() {
  return <Suspense fallback={<LoadingSkeleton label="Carregando perfil..." />}>
    <WorkerProfileExperience />
  </Suspense>;
}