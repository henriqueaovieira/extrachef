import 'server-only';
import { createHash } from 'node:crypto';
import { distanceMeters, validCoordinates } from '@/lib/work-location';
import {
  GeocodingError, type GeocodingAddress, type GeocodingCoordinates,
  type GeocodingProvider, type GeocodingResult,
} from './types';

const states: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará',
  PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const comparable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export class PhotonProvider implements GeocodingProvider {
  readonly name = 'photon';
  readonly namespace: string;
  constructor(private readonly endpoint: string, private readonly timeout: number) {
    this.namespace = createHash('sha256').update(`photon-v1:${endpoint}`).digest('hex');
  }

  private async search(path: string, parameters: Record<string, string>): Promise<GeocodingResult[]> {
    const url = new URL(`${this.endpoint}/${path}`);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    let response: Response;
    try {
      response = await fetch(url, {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(this.timeout),
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      throw new GeocodingError(timeout ? 'timeout' : 'offline',
        timeout ? 'A consulta do endereço excedeu o tempo limite. Tente novamente.'
          : 'Serviço de localização indisponível. Tente novamente.');
    }
    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const retry = header && /^\d+$/.test(header) ? Number(header)
        : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 60;
      throw new GeocodingError('rate_limited', 'Serviço de localização ocupado. Aguarde e tente novamente.',
        429, Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : 60, 429);
    }
    if (!response.ok) throw new GeocodingError('provider_error', 'Serviço de localização indisponível.', 503, undefined, response.status);
    let body: unknown;
    try { body = await response.json(); }
    catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        throw new GeocodingError('timeout', 'A consulta do endereço excedeu o tempo limite. Tente novamente.');
      }
      throw new GeocodingError('invalid_response', 'O serviço de localização retornou uma resposta inválida.', 502);
    }
    if (!object(body) || body.type !== 'FeatureCollection' || !Array.isArray(body.features)) {
      throw new GeocodingError('invalid_response', 'O serviço de localização retornou uma resposta inválida.', 502);
    }
    return body.features.map((feature: unknown) => {
      if (!object(feature) || !object(feature.geometry) || !object(feature.properties)
        || feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) {
        throw new GeocodingError('invalid_response', 'O serviço de localização retornou uma resposta inválida.', 502);
      }
      const [longitude, latitude] = feature.geometry.coordinates;
      if (!validCoordinates(latitude, longitude)) {
        throw new GeocodingError('invalid_coordinates', 'O serviço retornou coordenadas inválidas.', 502);
      }
      const properties = feature.properties;
      const stateName = text(properties.state);
      const state = Object.keys(states).find(key => comparable(states[key]) === comparable(stateName)
        || key.toLowerCase() === stateName.toLowerCase());
      return {
        latitude: Number(latitude), longitude: Number(longitude),
        address: {
          address: text(properties.street), number: text(properties.housenumber),
          neighborhood: text(properties.district), city: text(properties.city),
          state: state ?? '', postal_code: text(properties.postcode),
        },
        country: text(properties.countrycode).toLowerCase(),
        responseHash: createHash('sha256').update(JSON.stringify(feature)).digest('hex'),
      };
    }).filter(result => result.country === 'br');
  }

  async geocode(address: GeocodingAddress) {
    if (!address.number.trim() || !states[address.state]) {
      throw new GeocodingError('invalid_address', 'Informe o número do endereço e uma UF válida para localizar a operação.', 422);
    }
    const results = await this.search('api', {
      q: [address.address, address.number, address.neighborhood, address.city, states[address.state],
        address.postal_code, 'Brasil'].filter(Boolean).join(', '),
      limit: '5', lang: 'pt',
    });
    const matches = results.filter(result =>
      comparable(result.address.city) === comparable(address.city)
      && result.address.state === address.state
      && comparable(result.address.address) === comparable(address.address)
      && comparable(result.address.number) === comparable(address.number)
      && (!address.postal_code || result.address.postal_code.replace(/\D/g, '') === address.postal_code.replace(/\D/g, '')));
    if (!matches.length) {
      throw new GeocodingError('not_found', 'Não foi possível localizar o endereço completo com precisão. Confira rua, número, cidade e UF.', 422);
    }
    const first = matches[0];
    if (matches.some(result => distanceMeters(first.latitude, first.longitude, result.latitude, result.longitude) > 25)) {
      throw new GeocodingError('ambiguous', 'O endereço possui resultados diferentes. Confira os dados antes de publicar.', 422);
    }
    return first;
  }

  async reverseGeocode(coordinates: GeocodingCoordinates) {
    if (!validCoordinates(coordinates.latitude, coordinates.longitude)) {
      throw new GeocodingError('invalid_coordinates', 'Coordenadas inválidas.', 400);
    }
    const results = await this.search('reverse', {
      lat: String(coordinates.latitude), lon: String(coordinates.longitude), limit: '1', lang: 'pt',
    });
    if (!results.length) throw new GeocodingError('not_found', 'Endereço não localizado.', 422);
    return results[0];
  }
}
