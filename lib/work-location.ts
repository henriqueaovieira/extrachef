export interface WorkLocation {
  location_name: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
}

export const emptyWorkLocation: WorkLocation = {
  location_name: '', address: '', number: '', neighborhood: '',
  city: '', state: '', postal_code: '', latitude: null, longitude: null,
};

export function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}

export function validateWorkAddress(location: WorkLocation) {
  if (location.address.trim().length < 3 || location.address.length > 300
    || location.city.trim().length < 2 || location.city.length > 120
    || !/^[A-Z]{2}$/.test(location.state)
    || (location.postal_code !== '' && !/^\d{5}-?\d{3}$/.test(location.postal_code))
    || location.location_name.length > 160 || location.number.length > 30
    || location.neighborhood.length > 120) {
    throw new Error('Informe endereço, cidade e UF válidos; se informar CEP, use um formato válido.');
  }
}

export async function resolveWorkLocation(location: WorkLocation): Promise<WorkLocation> {
  validateWorkAddress(location);
  if (validCoordinates(location.latitude, location.longitude)) return location;
  try {
    const response = await fetch('/api/geocode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(location),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error : 'Não foi possível localizar o endereço.';
      throw new Error(message);
    }
    if (!body || typeof body !== 'object' || !('latitude' in body) || !('longitude' in body)
      || !validCoordinates(body.latitude, body.longitude)) {
      throw new Error('O serviço não retornou coordenadas válidas.');
    }
    return { ...location, latitude: Number(body.latitude), longitude: Number(body.longitude) };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Não foi possível localizar o endereço. Tente novamente.');
  }
}

export function jobLocationValues(location: WorkLocation) {
  return {
    location_name: location.location_name.trim(),
    work_address: location.address.trim(), work_number: location.number.trim(),
    work_neighborhood: location.neighborhood.trim(), work_city: location.city.trim(),
    work_state: location.state, work_postal_code: location.postal_code.replace(/\D/g, ''),
    work_latitude: location.latitude, work_longitude: location.longitude,
  };
}

export function eventLocationValues(location: WorkLocation) {
  const address = [location.address.trim(), location.number.trim(), location.neighborhood.trim()].filter(Boolean).join(', ');
  if (address.length > 300) throw new Error('O endereço completo do evento deve ter até 300 caracteres.');
  return {
    location_name: location.location_name.trim(),
    event_address: address,
    event_city: location.city.trim(), event_state: location.state,
    event_postal_code: location.postal_code.replace(/\D/g, ''),
    event_latitude: location.latitude, event_longitude: location.longitude,
  };
}

export interface EventLocationRow {
  location_name: string | null;
  event_address: string | null;
  event_city: string | null;
  event_state: string | null;
  event_postal_code: string | null;
  event_latitude: number | null;
  event_longitude: number | null;
}

export function locationFromEvent(event: EventLocationRow): WorkLocation {
  return {
    ...emptyWorkLocation,
    location_name: event.location_name ?? '', address: event.event_address ?? '',
    city: event.event_city ?? '', state: event.event_state ?? '',
    postal_code: event.event_postal_code ?? '',
    latitude: event.event_latitude, longitude: event.event_longitude,
  };
}

export function distanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  if (!validCoordinates(fromLat, fromLng) || !validCoordinates(toLat, toLng)) {
    throw new Error('Coordenadas inválidas para calcular distância.');
  }
  const radians = (value: number) => value * Math.PI / 180;
  const a = Math.sin(radians(toLat - fromLat) / 2) ** 2
    + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(radians(toLng - fromLng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

export function estimatedDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}
