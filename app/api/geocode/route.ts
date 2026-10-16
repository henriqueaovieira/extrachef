import { NextResponse, type NextRequest } from 'next/server';
import { createRequestClient } from '@/lib/supabase/request';
import { emptyWorkLocation, validCoordinates, validateWorkAddress } from '@/lib/work-location';

export async function POST(request: NextRequest) {
  const { supabase, finish } = createRequestClient(request);
  const reply = (body: object, status: number) => finish(NextResponse.json(body, { status }));
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return reply({ error: 'Faça login para localizar o endereço.' }, 401);
  const { data: user, error: userError } = await supabase.from('users').select('role').eq('id', auth.user.id).single();
  if (userError) return reply({ error: 'Não foi possível validar seu perfil.' }, 503);
  if (user.role !== 'restaurant') return reply({ error: 'Somente restaurantes podem localizar endereços operacionais.' }, 403);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply({ error: 'Endereço inválido.' }, 400);
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(body));
  const location = { ...emptyWorkLocation };
  for (const field of ['address', 'number', 'neighborhood', 'city', 'state', 'postal_code', 'location_name'] as const) {
    const value = fields[field];
    if (typeof value !== 'string') {
      return reply({ error: 'Endereço inválido.' }, 400);
    }
    location[field] = value.trim();
  }
  try { validateWorkAddress(location); }
  catch (error) { return reply({ error: error instanceof Error ? error.message : 'Endereço inválido.' }, 400); }

  const endpoint = process.env.GEOCODING_ENDPOINT;
  if (!endpoint) return reply({ error: 'Geocodificação não configurada. Solicite a configuração do serviço ao administrador.' }, 503);
  let url: URL;
  try {
    url = new URL(endpoint);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
  } catch {
    console.error('Invalid geocoding endpoint configuration.');
    return reply({ error: 'Configuração do serviço de geocodificação inválida.' }, 503);
  }
  try {
    const response = await fetch(url, {
      method: 'POST', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.GEOCODING_API_KEY ? { Authorization: `Bearer ${process.env.GEOCODING_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        address: location.address, number: location.number, neighborhood: location.neighborhood,
        city: location.city, state: location.state, postal_code: location.postal_code.replace(/\D/g, ''), country: 'BR',
      }),
    });
    if (!response.ok) {
      console.error('Geocoding provider failed.', { status: response.status });
      return reply({ error: response.status === 404 || response.status === 422
        ? 'Endereço não localizado. Confira os dados e tente novamente.'
        : 'Serviço de geocodificação indisponível. Tente novamente.' }, 502);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('latitude' in result) || !('longitude' in result)
      || !validCoordinates(result.latitude, result.longitude)) {
      console.error('Invalid geocoding response.');
      return reply({ error: 'O serviço não encontrou coordenadas válidas para este endereço.' }, 502);
    }
    return reply({ latitude: result.latitude, longitude: result.longitude }, 200);
  } catch (error) {
    console.error('Geocoding request failed.', { type: error instanceof Error ? error.name : 'unknown' });
    return reply({ error: 'Não foi possível consultar o endereço. Tente novamente.' }, 502);
  }
}
