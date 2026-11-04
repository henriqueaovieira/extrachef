import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { validCoordinates } from '@/lib/work-location';
import { GeocodingError, type GeocodingAddress, type GeocodingResult } from './types';

export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validAddress(value: unknown): value is GeocodingAddress {
  return value !== null && typeof value === 'object'
    && ['address', 'number', 'neighborhood', 'city', 'state', 'postal_code']
      .every(key => key in value && typeof Reflect.get(value, key) === 'string');
}

export class GeocodingCache {
  constructor(private readonly db: SupabaseClient, private readonly owner: string) {}

  async read(operation: string, namespace: string, key: string) {
    const { data, error } = await this.db.from('geocoding_cache')
      .select('latitude, longitude, result_address, provider_response_hash, expires_at')
      .eq('restaurant_id', this.owner).eq('operation', operation)
      .eq('provider_namespace', namespace).eq('address_hash', key).maybeSingle();
    if (error) throw new GeocodingError('cache_error', 'Não foi possível consultar o cache de localização.');
    if (!data) return { state: 'miss' as const };
    if (!validCoordinates(data.latitude, data.longitude) || !Number.isFinite(Date.parse(data.expires_at))
      || !validAddress(data.result_address) || typeof data.provider_response_hash !== 'string'
      || !/^[a-f0-9]{64}$/.test(data.provider_response_hash)) {
      throw new GeocodingError('cache_error', 'O cache de localização contém um resultado inválido.');
    }
    if (Date.parse(data.expires_at) <= Date.now()) return { state: 'refresh' as const };
    return { state: 'hit' as const, result: {
      latitude: data.latitude, longitude: data.longitude,
      address: data.result_address, responseHash: data.provider_response_hash,
    } satisfies GeocodingResult };
  }

  async write(operation: string, namespace: string, key: string, input: object, result: GeocodingResult, ttl: number, provider: string) {
    const { error } = await this.db.from('geocoding_cache').upsert({
      restaurant_id: this.owner, operation, provider_namespace: namespace, address_hash: key,
      normalized_address: input, latitude: result.latitude, longitude: result.longitude,
      result_address: result.address, provider, provider_response_hash: result.responseHash,
      updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    }, { onConflict: 'restaurant_id,operation,provider_namespace,address_hash' });
    if (error) throw new GeocodingError('cache_error', 'Não foi possível salvar a localização consultada.');
  }

  async invalidate(operation: string, namespace: string, key: string) {
    const { error } = await this.db.from('geocoding_cache').delete()
      .eq('restaurant_id', this.owner).eq('operation', operation)
      .eq('provider_namespace', namespace).eq('address_hash', key);
    if (error) throw new GeocodingError('cache_error', 'Não foi possível invalidar o cache de localização.');
  }

  async acquire(namespace: string, timeout: number) {
    const token = randomUUID();
    const { data, error } = await this.db.rpc('acquire_geocoding_request', {
      p_namespace: namespace, p_owner: this.owner, p_token: token, p_seconds: Math.ceil(timeout / 1000) + 10,
    });
    if (error) throw new GeocodingError('cache_error', 'Não foi possível coordenar a consulta de localização.');
    if (data !== true) throw new GeocodingError('rate_limited', 'Serviço de localização ocupado. Aguarde e tente novamente.', 429, 2);
    return token;
  }

  async release(namespace: string, token: string, cooldown: number) {
    const { error } = await this.db.rpc('release_geocoding_request', {
      p_namespace: namespace, p_token: token, p_cooldown: cooldown,
    });
    if (error) throw new GeocodingError('cache_error', 'Não foi possível concluir a consulta de localização.');
  }
}
