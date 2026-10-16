import type { CatalogLocation } from '@/lib/work-locations';

export type EventLocationStatus = 'not_set' | 'pending_coordinates' | 'ready';

export interface EventLocationSnapshot {
  work_location_id: string | null;
  location_name: string | null;
  event_address: string | null;
  event_number: string | null;
  event_neighborhood: string | null;
  event_city: string | null;
  event_state: string | null;
  event_postal_code: string | null;
  event_country_code: string | null;
  event_latitude: number | null;
  event_longitude: number | null;
  location_status: EventLocationStatus;
  location_snapshot_at: string | null;
  location_source_version: number | null;
}

export const eventLocationColumns = 'work_location_id, location_name, event_address, event_number, event_neighborhood, event_city, event_state, event_postal_code, event_country_code, event_latitude, event_longitude, location_status, location_snapshot_at, location_source_version';

export const eventLocationLabels: Record<EventLocationStatus, string> = {
  not_set: 'Local não definido',
  pending_coordinates: 'Coordenadas pendentes',
  ready: 'Coordenadas disponíveis',
};

export function eventLocationParameters(choice: string, locations: CatalogLocation[]) {
  if (choice === 'keep' || choice === 'none') {
    return {
      p_location_action: choice === 'keep' ? 'keep' : 'clear',
      p_work_location_id: null, p_location_revision: null,
    };
  }
  const selected = locations.find((location) => location.id === choice && !location.archived_at);
  if (!selected) throw new Error('Selecione um local ativo ou escolha definir depois.');
  return {
    p_location_action: 'set',
    p_work_location_id: selected.id,
    p_location_revision: selected.revision,
  };
}
