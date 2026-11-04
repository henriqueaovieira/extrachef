import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { GeocodingCache, hash } from './cache';
import { createGeocodingProvider, geocodingConfiguration } from './provider';
import {
  GeocodingError, normalizeAddress, type GeocodingAddress, type GeocodingCoordinates, type GeocodingProvider,
} from './types';

export function createGeocodingService(owner: string, requestId: string): GeocodingProvider {
  const config = geocodingConfiguration();
  const provider = createGeocodingProvider(config);
  const cache = new GeocodingCache(createAdminClient({ requestId }), owner);
  const log = (event: string, details: object = {}) =>
    console.info('geocoding', { requestId, event, ...details });

  async function resolve(operation: 'geocode' | 'reverse', input: GeocodingAddress | GeocodingCoordinates) {
    const started = Date.now();
    const normalized = 'address' in input ? normalizeAddress(input) : input;
    const key = hash({ version: 1, operation, input: normalized });
    try {
      const cached = await cache.read(operation, provider.namespace, key);
      log(`cache_${cached.state}`);
      if (cached.state === 'hit') return cached.result;
      const token = await cache.acquire(provider.namespace, config.timeout);
      let cooldown = 1;
      try {
        const result = 'address' in input ? await provider.geocode(input) : await provider.reverseGeocode(input);
        await cache.write(operation, provider.namespace, key, normalized, result, config.ttl, provider.name);
        log('resolved', { durationMs: Date.now() - started });
        return result;
      } catch (error) {
        if (error instanceof GeocodingError && error.code === 'rate_limited') cooldown = error.retryAfter ?? 60;
        throw error;
      } finally {
        await cache.release(provider.namespace, token, cooldown);
      }
    } catch (error) {
      log('failed', {
        code: error instanceof GeocodingError ? error.code : 'internal',
        providerStatus: error instanceof GeocodingError ? error.providerStatus : undefined,
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
  return {
    name: provider.name, namespace: provider.namespace,
    geocode: address => resolve('geocode', address),
    reverseGeocode: coordinates => resolve('reverse', coordinates),
  };
}
