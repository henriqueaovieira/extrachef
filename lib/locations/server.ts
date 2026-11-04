import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRequestClient } from '@/lib/supabase/request';
import { createGeocodingService } from '@/lib/geocoding';
import { GeocodingError, type GeocodingProvider } from '@/lib/geocoding/types';
import {
  parseLocation, postalCodeDigits, validateLocationInput, type CatalogLocation, type LocationInput,
} from '@/lib/work-locations';

type Reply = (body: object, status: number) => NextResponse;
export type AuthorizedRestaurant = { ok: true; supabase: SupabaseClient; userId: string; requestId: string; reply: Reply };
export type RestaurantRequest = AuthorizedRestaurant | { ok: false; response: NextResponse };

export async function authorizeRestaurantRequest(request: NextRequest, scope: string): Promise<RestaurantRequest> {
  const { supabase, finish } = createRequestClient(request);
  const requestId = randomUUID();
  const reply: Reply = (body, status) => {
    const response = finish(NextResponse.json(body, { status }));
    response.headers.set('X-Request-Id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
  const deny = (event: string, error: string, status: number) => {
    console.warn(scope, { requestId, event });
    return { ok: false as const, response: reply({ error }, status) };
  };
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return deny('auth_failed', 'Faça login para gerenciar locais.', 401);
  const { data: user, error: userError } = await supabase.from('users').select('role').eq('id', auth.user.id).single();
  if (userError) return deny('profile_failed', 'Não foi possível validar seu perfil.', 503);
  if (!user || user.role !== 'restaurant') return deny('forbidden', 'Somente restaurantes podem gerenciar locais operacionais.', 403);
  const { data: active, error: activeError } = await supabase.rpc('account_is_active');
  if (activeError) return deny('account_validation_failed', 'Não foi possível validar sua conta.', 503);
  if (active !== true) return deny('inactive_account', 'Entre em uma conta ativa do restaurante.', 403);
  return { ok: true, supabase, userId: auth.user.id, requestId, reply };
}

export function parseLocationInput(body: unknown): LocationInput {
  if (!body || typeof body !== 'object') throw new Error('Dados do local inválidos.');
  const value = (key: string) => Reflect.get(body, key);
  const text = (key: string) => {
    const field = value(key);
    if (typeof field !== 'string') throw new Error('Dados do local inválidos.');
    return field.trim();
  };
  const kind = value('kind');
  if (kind !== 'permanent' && kind !== 'temporary') throw new Error('Tipo de local inválido.');
  const validUntil = value('valid_until');
  if (validUntil !== null && validUntil !== undefined && typeof validUntil !== 'string') throw new Error('Validade inválida.');
  const input: LocationInput = {
    name: text('name'), address: text('address'), number: text('number'), neighborhood: text('neighborhood'),
    city: text('city'), state: text('state').toUpperCase(), postal_code: text('postal_code'),
    kind, valid_until: validUntil ?? null, make_default: value('make_default') === true,
  };
  validateLocationInput(input);
  return input;
}

export const rpcStatus = (code: string | undefined) =>
  code === '40001' ? 409 : code === 'P0002' ? 404 : code === '42501' ? 403 : 400;

export interface SavedLocationResult {
  location: CatalogLocation;
  geocodingError?: { code: string; message: string; retryAfter?: number };
}

// Only definitive address problems are persisted; transient failures keep the location pending for a retry.
const persistentFailures = new Set(['not_found', 'ambiguous', 'invalid_address']);

export async function locateSavedLocation(
  context: AuthorizedRestaurant,
  saved: CatalogLocation,
  createService: (owner: string, requestId: string) => GeocodingProvider = createGeocodingService,
): Promise<{ status: number; body: SavedLocationResult | { error: string } }> {
  const { supabase, userId, requestId } = context;
  let location = saved;
  if (location.archived_at || location.geocoding_status === 'resolved' || location.geocoding_status === 'needs_review') {
    return { status: 200, body: { location } };
  }
  try {
    await createService(userId, requestId).geocode({
      address: location.address, number: location.number, neighborhood: location.neighborhood,
      city: location.city, state: location.state, postal_code: location.postal_code,
    });
  } catch (failure) {
    const code = failure instanceof GeocodingError ? failure.code : 'internal';
    console.warn('locations', { requestId, event: 'geocoding_failed', code });
    if (persistentFailures.has(code)) {
      const { data: failed } = await supabase.rpc('record_work_location_geocoding_failure', {
        p_id: location.id, p_address_version: location.address_version, p_code: code,
      });
      if (failed) location = parseLocation(failed);
    }
    return { status: 200, body: { location, geocodingError: {
      code,
      message: failure instanceof GeocodingError ? failure.message : 'Não foi possível localizar o endereço. Tente novamente.',
      retryAfter: failure instanceof GeocodingError ? failure.retryAfter : undefined,
    } } };
  }
  const { data: applied, error: applyError } = await supabase.rpc('apply_work_location_geocode', {
    p_id: location.id, p_address_version: location.address_version,
  });
  if (applyError) {
    console.error('locations', { requestId, event: 'apply_failed', code: applyError.code });
    return { status: rpcStatus(applyError.code), body: { error: applyError.message } };
  }
  location = parseLocation(applied);
  console.info('locations', { requestId, event: 'located', status: location.geocoding_status });
  return { status: 200, body: { location } };
}

/** Saves with the user's session and geocodes on the server; the browser never sends coordinates. */
export async function saveAndLocate(
  context: AuthorizedRestaurant,
  input: LocationInput,
  target: { id: string; revision: number } | null,
  createService?: (owner: string, requestId: string) => GeocodingProvider,
): Promise<{ status: number; body: SavedLocationResult | { error: string } }> {
  const { data, error } = await context.supabase.rpc('save_restaurant_location', {
    p_name: input.name, p_address: input.address, p_number: input.number, p_neighborhood: input.neighborhood,
    p_city: input.city, p_state: input.state, p_postal_code: postalCodeDigits(input.postal_code),
    p_kind: input.kind, p_valid_until: input.valid_until, p_make_default: input.make_default,
    p_id: target?.id ?? null, p_expected_revision: target?.revision ?? null,
  });
  if (error) {
    console.warn('locations', { requestId: context.requestId, event: 'save_failed', code: error.code });
    return { status: rpcStatus(error.code), body: { error: error.message } };
  }
  return locateSavedLocation(context, parseLocation(data), createService);
}
