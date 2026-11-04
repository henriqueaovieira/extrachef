import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createRequestClient } from '@/lib/supabase/request';
import { emptyWorkLocation, validateWorkAddress } from '@/lib/work-location';
import { createGeocodingService } from '@/lib/geocoding';
import { GeocodingError } from '@/lib/geocoding/types';

export async function POST(request: NextRequest) {
  const { supabase, finish } = createRequestClient(request);
  const requestId = randomUUID();
  const reply = (body: object, status: number) => {
    const response = finish(NextResponse.json(body, { status }));
    response.headers.set('X-Request-Id', requestId);
    return response;
  };
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    console.warn('geocoding', { requestId, event: 'auth_failed' });
    return reply({ error: 'Faça login para localizar o endereço.' }, 401);
  }
  const { data: user, error: userError } = await supabase.from('users').select('role').eq('id', auth.user.id).single();
  if (userError) {
    console.error('geocoding', { requestId, event: 'profile_failed' });
    return reply({ error: 'Não foi possível validar seu perfil.' }, 503);
  }
  if (!user || user.role !== 'restaurant') {
    console.warn('geocoding', { requestId, event: 'forbidden' });
    return reply({ error: 'Somente restaurantes ativos podem localizar endereços operacionais.' }, 403);
  }
  const { data: active, error: activeError } = await supabase.rpc('account_is_active');
  if (activeError) {
    console.error('geocoding', { requestId, event: 'account_validation_failed' });
    return reply({ error: 'Não foi possível validar sua conta.' }, 503);
  }
  if (active !== true) return reply({ error: 'Entre em uma conta ativa do restaurante.' }, 403);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply({ error: 'Endereço inválido.' }, 400);
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(body));
  const location = { ...emptyWorkLocation };
  for (const field of ['address', 'number', 'neighborhood', 'city', 'state', 'postal_code', 'location_name'] as const) {
    const value = fields[field];
    if (field === 'postal_code' && value === undefined) continue;
    if (typeof value !== 'string') {
      return reply({ error: 'Endereço inválido.' }, 400);
    }
    location[field] = value.trim();
  }
  try { validateWorkAddress(location); }
  catch (error) { return reply({ error: error instanceof Error ? error.message : 'Endereço inválido.' }, 400); }

  try {
    const result = await createGeocodingService(auth.user.id, requestId).geocode(location);
    return reply({ latitude: result.latitude, longitude: result.longitude }, 200);
  } catch (error) {
    console.error('geocoding', { requestId, event: 'request_failed',
      code: error instanceof GeocodingError ? error.code : 'internal' });
    if (error instanceof GeocodingError) {
      const response = reply({ error: error.message }, error.status);
      if (error.retryAfter) response.headers.set('Retry-After', String(error.retryAfter));
      return response;
    }
    return reply({ error: 'Não foi possível consultar o endereço. Tente novamente.' }, 503);
  }
}
