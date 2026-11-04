'use client';

import { useSearchParams } from 'next/navigation';
import ProfileEditor from '@/app/components/profile-editor';
import ProfileOverview from '@/app/components/profile-overview';

export default function WorkerProfileExperience() {
  const searchParams = useSearchParams();
  return searchParams.get('edit') === '1'
    ? <ProfileEditor role="worker" />
    : <ProfileOverview role="worker" />;
}
