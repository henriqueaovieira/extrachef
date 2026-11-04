import type { SupabaseClient } from '@supabase/supabase-js';
import { getDeviceCoordinates } from '@/lib/geolocation';
import {
  catalogLocationColumns, parseLocation, postalCodeDigits, type CatalogLocation, type LocationInput,
} from '@/lib/work-locations';

export interface LocationSaveResult {
  location: CatalogLocation;
  geocodingError?: { code: string; message: string; retryAfter?: number };
}

export interface PostalCodeLookup {
  postal_code: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
}

async function request(url: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' }, cache: 'no-store' });
  } catch {
    throw new Error('Sem conexão. Verifique a internet e tente novamente.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && typeof Reflect.get(body, 'error') === 'string'
      ? Reflect.get(body, 'error') as string : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  return body;
}

function saveResult(body: unknown): LocationSaveResult {
  if (!body || typeof body !== 'object') throw new Error('O serviço não confirmou o local salvo.');
  const geocodingError = Reflect.get(body, 'geocodingError');
  return {
    location: parseLocation(Reflect.get(body, 'location')),
    geocodingError: geocodingError && typeof geocodingError === 'object'
      ? geocodingError as LocationSaveResult['geocodingError'] : undefined,
  };
}

export async function loadWorkLocations(supabase: SupabaseClient, ownerId: string) {
  const { data, error } = await supabase.from('work_locations').select(catalogLocationColumns)
    .eq('restaurant_id', ownerId).order('name', { ascending: true });
  if (error) throw new Error('Não foi possível carregar os locais operacionais.');
  const locations = (data ?? []).map(parseLocation);
  return locations.sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

export async function saveLocation(input: LocationInput, target?: { id: string; revision: number }) {
  const location = { ...input, postal_code: postalCodeDigits(input.postal_code) };
  return saveResult(await request(target ? `/api/locations/${target.id}` : '/api/locations', target
    ? { method: 'PATCH', body: JSON.stringify({ revision: target.revision, location }) }
    : { method: 'POST', body: JSON.stringify(location) }));
}

export async function retryLocation(id: string) {
  return saveResult(await request(`/api/locations/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'locate' }) }));
}

export async function lookupPostalCode(cep: string): Promise<PostalCodeLookup> {
  const body = await request(`/api/postal-code/${postalCodeDigits(cep)}`, { method: 'GET' });
  const address = body && typeof body === 'object' ? Reflect.get(body, 'address') : null;
  if (!address || typeof address !== 'object') throw new Error('CEP não encontrado.');
  return address as PostalCodeLookup;
}

export async function confirmLocation(
  supabase: SupabaseClient,
  location: CatalogLocation,
  method: 'device' | 'approximate',
) {
  const coordinates = method === 'device' ? await getDeviceCoordinates() : null;
  const { data, error } = await supabase.rpc('confirm_work_location', {
    p_id: location.id, p_expected_revision: location.revision, p_method: method,
    p_latitude: coordinates?.latitude ?? null, p_longitude: coordinates?.longitude ?? null,
    p_accuracy: coordinates?.accuracy ?? null,
  });
  if (error) throw new Error(error.message);
  return parseLocation(data);
}

export async function manageLocation(
  supabase: SupabaseClient,
  location: CatalogLocation,
  action: 'set_default' | 'archive' | 'restore',
) {
  const { error } = await supabase.rpc('manage_work_location', {
    p_id: location.id, p_action: action, p_expected_revision: location.revision,
  });
  if (error) throw new Error(error.message);
}
