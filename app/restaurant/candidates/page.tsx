'use client';

import { useSearchParams } from 'next/navigation';
import RestaurantMessageCenter from '@/app/restaurant/messages/message-center';
import TalentCenter from '@/app/restaurant/candidates/talent-center';

export default function RestaurantCandidatesPage() {
  const searchParams = useSearchParams();
  return searchParams.get('view') === 'messages' ? <RestaurantMessageCenter /> : <TalentCenter initialDemandId={searchParams.get('demand')} />;
}
