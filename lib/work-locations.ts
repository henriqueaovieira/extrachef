export type GeocodingStatus = 'pending' | 'resolved' | 'failed' | 'needs_review';

export interface LocationForm {
  name: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
}

export interface CatalogLocation extends LocationForm {
  id: string;
  restaurant_id: string;
  country_code: 'BR';
  latitude: number | null;
  longitude: number | null;
  geocoding_status: GeocodingStatus;
  address_version: number;
  revision: number;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const catalogLocationColumns = 'id, restaurant_id, name, address, number, neighborhood, city, state, postal_code, country_code, latitude, longitude, geocoding_status, address_version, revision, is_default, archived_at, created_at, updated_at';
