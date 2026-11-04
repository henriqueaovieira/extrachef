export type GeocodingStatus = 'pending' | 'resolved' | 'failed' | 'needs_review';
export type LocationKind = 'permanent' | 'temporary';
export type GeocodingPrecision = 'house' | 'street' | 'device';

export interface LocationForm {
  name: string;
  address: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
}

export interface LocationInput extends LocationForm {
  kind: LocationKind;
  valid_until: string | null;
  make_default: boolean;
}

export interface CatalogLocation extends LocationForm {
  id: string;
  restaurant_id: string;
  country_code: 'BR';
  latitude: number | null;
  longitude: number | null;
  geocoding_status: GeocodingStatus;
  geocoding_precision: GeocodingPrecision | null;
  geocoding_error_code: string | null;
  candidate_latitude: number | null;
  candidate_longitude: number | null;
  kind: LocationKind;
  valid_until: string | null;
  confirmed_at: string | null;
  address_version: number;
  revision: number;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const catalogLocationColumns = 'id, restaurant_id, name, address, number, neighborhood, city, state, postal_code, country_code, latitude, longitude, geocoding_status, geocoding_precision, geocoding_error_code, candidate_latitude, candidate_longitude, kind, valid_until, confirmed_at, address_version, revision, is_default, archived_at, created_at, updated_at';

export const brazilianStates = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const emptyLocationInput: LocationInput = {
  name: '', address: '', number: '', neighborhood: '', city: '', state: '', postal_code: '',
  kind: 'permanent', valid_until: null, make_default: false,
};

export const postalCodeDigits = (value: string) => value.replace(/\D/g, '');

export function todayInSaoPaulo(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export function validateLocationInput(input: LocationInput) {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (input.name.trim().length < 2 || input.name.length > 160) throw new Error('Informe um nome para o local (2 a 160 caracteres).');
  if (!/^\d{8}$/.test(postalCodeDigits(input.postal_code)) || !/^\d{5}-?\d{3}$/.test(input.postal_code.trim())) {
    throw new Error('Informe um CEP válido com 8 dígitos.');
  }
  if (input.address.trim().length < 3 || input.address.length > 300) throw new Error('Informe a rua do local.');
  if (!input.number.trim() || input.number.length > 30) throw new Error('Informe o número do endereço.');
  if (input.neighborhood.length > 120) throw new Error('O bairro deve ter até 120 caracteres.');
  if (input.city.trim().length < 2 || input.city.length > 120) throw new Error('Informe a cidade do local.');
  if (!(brazilianStates as readonly string[]).includes(input.state)) throw new Error('Selecione a UF do local.');
  if (input.kind !== 'permanent' && input.kind !== 'temporary') throw new Error('Tipo de local inválido.');
  if (input.kind === 'temporary' && (!input.valid_until || !date.test(input.valid_until))) {
    throw new Error('Informe até quando o local temporário será usado.');
  }
  if (input.kind === 'permanent' && input.valid_until !== null) throw new Error('Somente locais temporários possuem validade.');
  if (input.kind === 'temporary' && input.make_default) throw new Error('Um local temporário não pode ser o endereço principal.');
}

export function locationSelectable(location: CatalogLocation, operationDate = '', today = todayInSaoPaulo()) {
  if (location.archived_at || location.geocoding_status !== 'resolved') return false;
  if (location.kind !== 'temporary') return true;
  if (!location.valid_until || location.valid_until < today) return false;
  return !operationDate || operationDate <= location.valid_until;
}

export function formatLocationAddress(location: LocationForm) {
  const postal = postalCodeDigits(location.postal_code);
  const street = [location.address, location.number].filter(Boolean).join(', ');
  const city = [location.city, location.state].filter(Boolean).join('/');
  return [street, location.neighborhood, city, postal.length === 8 ? `CEP ${postal.slice(0, 5)}-${postal.slice(5)}` : '']
    .filter(Boolean).join(' · ');
}

export function locationStatusLabel(location: CatalogLocation) {
  if (location.archived_at) return 'Arquivado';
  if (location.geocoding_status === 'resolved') {
    return location.geocoding_precision === 'street' ? 'Localização aproximada confirmada' : 'Localização confirmada';
  }
  if (location.geocoding_status === 'needs_review') return 'Confirme a posição exata';
  if (location.geocoding_status === 'failed') return 'Endereço não localizado';
  return 'Localização pendente';
}

export function parseLocation(value: unknown): CatalogLocation {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
    || !('revision' in value) || typeof value.revision !== 'number'
    || !('geocoding_status' in value) || typeof value.geocoding_status !== 'string') {
    throw new Error('O serviço não confirmou o local salvo.');
  }
  return value as CatalogLocation;
}
