export type GeocodingStatus = 'pending' | 'resolved' | 'failed' | 'needs_review';
export type LocationAction = 'set_default' | 'unset_default' | 'archive' | 'restore' | 'delete';

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

export const emptyLocationForm: LocationForm = {
  name: '', address: '', number: '', neighborhood: '', city: '', state: '', postal_code: '',
};

export const catalogLocationColumns = 'id, restaurant_id, name, address, number, neighborhood, city, state, postal_code, country_code, latitude, longitude, geocoding_status, address_version, revision, is_default, archived_at, created_at, updated_at';

export const geocodingLabels: Record<GeocodingStatus, string> = {
  pending: 'Coordenadas pendentes',
  resolved: 'Coordenadas disponíveis',
  failed: 'Não foi possível localizar',
  needs_review: 'Localização precisa de revisão',
};

export function locationParameters(form: LocationForm, editing: CatalogLocation | null) {
  const values = {
    name: form.name.trim(), address: form.address.trim(), number: form.number.trim(),
    neighborhood: form.neighborhood.trim(), city: form.city.trim(),
    state: form.state.trim().toUpperCase(), postal_code: form.postal_code.replace(/\D/g, ''),
  };
  if (values.name.length < 2 || values.name.length > 160
    || values.address.length < 3 || values.address.length > 300
    || values.city.length < 2 || values.city.length > 120
    || values.number.length > 30 || values.neighborhood.length > 120
    || !/^[A-Z]{2}$/.test(values.state)
    || (values.postal_code !== '' && !/^\d{8}$/.test(values.postal_code))) {
    throw new Error('Confira nome, endereço, cidade, UF e CEP. O CEP é opcional; quando informado, deve ter 8 dígitos.');
  }
  return {
    p_name: values.name, p_address: values.address, p_number: values.number,
    p_neighborhood: values.neighborhood, p_city: values.city, p_state: values.state,
    p_postal_code: values.postal_code, p_id: editing?.id ?? null,
    p_expected_revision: editing?.revision ?? null,
  };
}
