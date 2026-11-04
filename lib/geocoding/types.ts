import type { WorkLocation } from '@/lib/work-location';

export type GeocodingAddress = Pick<WorkLocation, 'address' | 'number' | 'neighborhood' | 'city' | 'state' | 'postal_code'>;
export interface GeocodingCoordinates { latitude: number; longitude: number }
export interface GeocodingResult extends GeocodingCoordinates {
  address: GeocodingAddress;
  responseHash: string;
}
export interface GeocodingProvider {
  readonly name: string;
  readonly namespace: string;
  geocode(address: GeocodingAddress): Promise<GeocodingResult>;
  reverseGeocode(coordinates: GeocodingCoordinates): Promise<GeocodingResult>;
}
export type GeocodingErrorCode = 'configuration' | 'invalid_address' | 'not_found' | 'ambiguous'
  | 'timeout' | 'offline' | 'rate_limited' | 'provider_error' | 'invalid_response'
  | 'invalid_coordinates' | 'cache_error';

export class GeocodingError extends Error {
  constructor(
    public readonly code: GeocodingErrorCode,
    message: string,
    public readonly status = 503,
    public readonly retryAfter?: number,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = 'GeocodingError';
  }
}

export function normalizeAddress(address: GeocodingAddress) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  return {
    address: normalize(address.address), number: normalize(address.number),
    neighborhood: normalize(address.neighborhood), city: normalize(address.city),
    state: normalize(address.state), postal_code: address.postal_code.replace(/\D/g, ''),
    country: 'br',
  };
}
