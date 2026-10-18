export type DemandTalentStatus = 'awaiting' | 'accepted' | 'approved' | 'unavailable' | 'candidate';

export interface DemandApplicationState {
  worker_id: string;
  status: string;
}

export interface DemandInvitationState {
  worker_id: string;
  status: string;
}

export interface SuggestionCandidate {
  id: string;
  categories: string[];
  specialties: string[] | null;
  completed_operations: number;
  score: number | null;
  reputation: { average_rating: number | null; completed: number } | null;
}

const hiredStatuses = ['approved', 'in_progress', 'completed'];

export const demandStatusLabels: Record<Exclude<DemandTalentStatus, 'candidate'>, string> = {
  awaiting: '🟡 Aguardando resposta',
  accepted: '🟢 Convite aceito',
  approved: '🟢 Aprovado',
  unavailable: '⚪ Indisponível para esta demanda',
};

/**
 * Splits the people related to one demand into the "Convidados" and "Candidatos" sections.
 * Approved candidates move to "Convidados"; declined invitations are shown neutrally as unavailable.
 */
export function classifyDemandTalents(applications: DemandApplicationState[], invitations: DemandInvitationState[]) {
  const applicationByWorker = new Map<string, string>();
  for (const application of applications) {
    const current = applicationByWorker.get(application.worker_id);
    if (!current || hiredStatuses.includes(application.status) || (current !== 'pending' && application.status === 'pending' && !hiredStatuses.includes(current))) {
      applicationByWorker.set(application.worker_id, application.status);
    }
  }
  const invited = new Map<string, Exclude<DemandTalentStatus, 'candidate'>>();
  const candidates = new Map<string, 'candidate'>();
  for (const invitation of invitations) {
    const application = applicationByWorker.get(invitation.worker_id);
    if (application && hiredStatuses.includes(application)) invited.set(invitation.worker_id, 'approved');
    else if (invitation.status === 'pending') invited.set(invitation.worker_id, 'awaiting');
    else if (invitation.status === 'accepted' && application === 'pending') invited.set(invitation.worker_id, 'accepted');
    else invited.set(invitation.worker_id, 'unavailable');
  }
  for (const [workerId, status] of applicationByWorker) {
    if (invited.has(workerId)) continue;
    if (hiredStatuses.includes(status)) invited.set(workerId, 'approved');
    else if (status === 'pending') candidates.set(workerId, 'candidate');
  }
  return { invited, candidates, applicationByWorker };
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function matchesDemandFunction(specialties: string[] | null, demandTitle: string) {
  const title = normalize(demandTitle);
  if (!title) return false;
  return (specialties ?? []).some((specialty) => {
    const value = normalize(specialty);
    return value.length > 0 && (title.includes(value) || value.includes(title));
  });
}

/** Ranks by: favorites, worked with the restaurant, rating, completed operations, demand function. */
export function rankSuggestions<T extends SuggestionCandidate>(people: T[], demandTitle: string) {
  const rating = (person: T) => person.reputation?.average_rating ?? person.score ?? -1;
  return [...people].sort((a, b) => Number(b.categories.includes('favorite')) - Number(a.categories.includes('favorite'))
    || Number(b.completed_operations > 0) - Number(a.completed_operations > 0)
    || rating(b) - rating(a)
    || (b.reputation?.completed ?? 0) - (a.reputation?.completed ?? 0)
    || Number(matchesDemandFunction(b.specialties, demandTitle)) - Number(matchesDemandFunction(a.specialties, demandTitle))
    || a.id.localeCompare(b.id));
}

/** Keeps previous suggestions while they remain eligible and only fills the free slots. */
export function stableSuggestions(previous: string[], rankedEligible: string[], max = 3) {
  const eligible = new Set(rankedEligible);
  const kept = previous.filter((id) => eligible.has(id)).slice(0, max);
  for (const id of rankedEligible) {
    if (kept.length >= max) break;
    if (!kept.includes(id)) kept.push(id);
  }
  return kept;
}

export function relativeTime(value: string | null, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
  if (days === 0) return 'hoje';
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(days / 365);
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`;
}
