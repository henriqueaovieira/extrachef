'use client';

import { createContext, useContext } from 'react';
import type { CommunicationCounts } from '@/lib/communication';

export const CommunicationContext = createContext<{
  counts: CommunicationCounts;
  error: string;
  chatError: string;
  refresh: () => Promise<void>;
  markRead: (jobId: string, messageIds: string[]) => Promise<void>;
} | null>(null);

export function useCommunication() {
  const context = useContext(CommunicationContext);
  if (!context) throw new Error('CommunicationContext deve envolver os componentes de comunicação.');
  return context;
}
