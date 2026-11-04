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
// Photon public instances only accept default/de/en/fr; "default" returns local OSM names (pt-BR in Brazil).
const LANGUAGE = 'default';
const MAX_LOGGED_BODY = 10_000;
// Maximum spread between equivalent results: same building vs. segments of the same street.
const HOUSE_TOLERANCE_METERS = 25;
const STREET_TOLERANCE_METERS = 1000;

const abbreviations: Record<string, string> = {
  r: 'rua', av: 'avenida', avn: 'avenida', al: 'alameda', tv: 'travessa', trav: 'travessa',
  pc: 'praca', pca: 'praca', rod: 'rodovia', estr: 'estrada', est: 'estrada',
  lgo: 'largo', lg: 'largo', vd: 'viaduto', pq: 'parque', jd: 'jardim', vl: 'vila',
  dr: 'doutor', dra: 'doutora', prof: 'professor', profa: 'professora', eng: 'engenheiro',
  sen: 'senador', dep: 'deputado', pres: 'presidente', gov: 'governador', ver: 'vereador',
  cel: 'coronel', cap: 'capitao', maj: 'major', ten: 'tenente', sgt: 'sargento', gen: 'general',
  gal: 'general', mal: 'marechal', alm: 'almirante', brig: 'brigadeiro', cmte: 'comandante',
  sta: 'santa', sto: 'santo', s: 'sao', pe: 'padre', fr: 'frei', d: 'dom', ns: 'nossa senhora',
};
const stopwords = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const comparable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const comparableStreet = (value: string) => comparable(value).split(' ')
  .map(word => abbreviations[word] ?? word).join(' ').split(' ')
  .filter(word => word && !stopwords.has(word)).join(' ');
const comparableNumber = (value: string) => comparable(value).replace(/\s+/g, '');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

interface PhotonResult extends GeocodingResult { country: string }

export class PhotonProvider implements GeocodingProvider {
  readonly name = 'photon';
  readonly namespace: string;
  constructor(private readonly endpoint: string, private readonly timeout: number) {
    this.namespace = createHash('sha256').update(`photon-v1:${endpoint}`).digest('hex');
  }

  private url(path: string, parameters: Record<string, string>) {
    // Trailing slash keeps any base path from the endpoint (e.g. https://host/photon + api).
    const url = new URL(path, this.endpoint.endsWith('/') ? this.endpoint : `${this.endpoint}/`);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    return url;
  }

  private async search(path: 'api' | 'reverse', parameters: Record<string, string>): Promise<PhotonResult[]> {
    const url = this.url(path, parameters);
    const started = Date.now();
    const log = (level: 'info' | 'warn' | 'error', event: string, details: object = {}) =>
      console[level]('geocoding_provider', {
        provider: this.name, event, path, url: url.toString(), durationMs: Date.now() - started, ...details,
      });
    log('info', 'provider_request', { parameters });
    let response: Response;
    try {
      response = await fetch(url, {
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(this.timeout),
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      const timeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      log('error', timeout ? 'provider_timeout' : 'provider_offline', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new GeocodingError(timeout ? 'timeout' : 'offline',
        timeout ? 'A consulta do endereço excedeu o tempo limite. Tente novamente.'
          : 'Serviço de localização indisponível. Tente novamente.');
    }
    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const retry = header && /^\d+$/.test(header) ? Number(header)
        : header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 60;
      log('warn', 'provider_rate_limited', { status: 429, retryAfter: header });
      throw new GeocodingError('rate_limited', 'Serviço de localização ocupado. Aguarde e tente novamente.',
        429, Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : 60, 429);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log('error', 'provider_http_error', {
        status: response.status, statusText: response.statusText,
        body: body.slice(0, MAX_LOGGED_BODY), bodyTruncated: body.length > MAX_LOGGED_BODY,
      });
      throw new GeocodingError('provider_error', 'Serviço de localização indisponível.', 503, undefined, response.status);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        log('error', 'provider_timeout', { status: response.status, stage: 'body' });
        throw new GeocodingError('timeout', 'A consulta do endereço excedeu o tempo limite. Tente novamente.');
      }
      log('error', 'provider_invalid_response', { status: response.status, reason: 'invalid_json' });
      throw new GeocodingError('invalid_response', 'O serviço de localização retornou uma resposta inválida.', 502);
    }
    if (!object(body) || body.type !== 'FeatureCollection' || !Array.isArray(body.features)) {
      log('error', 'provider_invalid_response', { status: response.status, reason: 'invalid_shape' });
      throw new GeocodingError('invalid_response', 'O serviço de localização retornou uma resposta inválida.', 502);
    }
    const results = body.features.map((feature: unknown): PhotonResult => {
      if (!object(feature) || !object(feature.geometry) || !object(feature.properties)
        || feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) {
        log('error', 'provider_invalid_response', { status: response.status, reason: 'invalid_feature' });
        throw new GeocodingError('invalid_response', 'O serviço de localização retornou uma resposta inválida.', 502);
      }
      const [longitude, latitude] = feature.geometry.coordinates;
      if (!validCoordinates(latitude, longitude)) {
        log('error', 'provider_invalid_coordinates', { status: response.status });
        throw new GeocodingError('invalid_coordinates', 'O serviço retornou coordenadas inválidas.', 502);
      }
      const properties = feature.properties;
      const stateName = text(properties.state);
      const state = Object.keys(states).find(key => comparable(states[key]) === comparable(stateName)
        || key.toLowerCase() === stateName.toLowerCase());
      // Street features carry the street in "name" instead of "street".
      const street = text(properties.street) || (text(properties.type) === 'street' ? text(properties.name) : '');
      return {
        latitude: Number(latitude), longitude: Number(longitude),
        address: {
          address: street, number: text(properties.housenumber),
          neighborhood: text(properties.district), city: text(properties.city),
          state: state ?? '', postal_code: text(properties.postcode),
        },
        country: text(properties.countrycode).toLowerCase(),
        responseHash: createHash('sha256').update(JSON.stringify(feature)).digest('hex'),
      };
    }).filter(result => result.country === 'br');
    log('info', 'provider_response', {
      status: response.status, features: body.features.length, brazilianResults: results.length,
    });
    return results;
  }

  async geocode(address: GeocodingAddress): Promise<GeocodingResult> {
    if (!address.number.trim() || !states[address.state]) {
      throw new GeocodingError('invalid_address', 'Informe o número do endereço e uma UF válida para localizar a operação.', 422);
    }
    const results = await this.search('api', {
      q: [address.address, address.number, address.neighborhood, address.city, states[address.state],
        address.postal_code, 'Brasil'].filter(Boolean).join(', '),
      limit: '5', lang: LANGUAGE,
    });
    const street = comparableStreet(address.address);
    const number = comparableNumber(address.number);
    const postalCode = address.postal_code.replace(/\D/g, '');
    const candidates = results.filter(result =>
      comparable(result.address.city) === comparable(address.city)
      && result.address.state === address.state
      && street !== '' && comparableStreet(result.address.address) === street
      && (!postalCode || !result.address.postal_code
        || result.address.postal_code.replace(/\D/g, '') === postalCode));
    // A returned house number must match; results without one are street-level fallbacks.
    const houses = candidates.filter(result => comparableNumber(result.address.number) === number);
    const streets = candidates.filter(result => !result.address.number);
    const [matches, tolerance] = houses.length
      ? [houses, HOUSE_TOLERANCE_METERS] : [streets, STREET_TOLERANCE_METERS];
    if (!matches.length) {
      throw new GeocodingError('not_found', 'Não foi possível localizar o endereço completo com precisão. Confira rua, número, cidade e UF.', 422);
    }
    const first = matches[0];
    if (matches.some(result => distanceMeters(first.latitude, first.longitude, result.latitude, result.longitude) > tolerance)) {
      throw new GeocodingError('ambiguous', 'O endereço possui resultados diferentes. Confira os dados antes de publicar.', 422);
    }
    return { latitude: first.latitude, longitude: first.longitude, address: first.address, responseHash: first.responseHash };
  }

  async reverseGeocode(coordinates: GeocodingCoordinates): Promise<GeocodingResult> {
    if (!validCoordinates(coordinates.latitude, coordinates.longitude)) {
      throw new GeocodingError('invalid_coordinates', 'Coordenadas inválidas.', 400);
    }
    const results = await this.search('reverse', {
      lat: String(coordinates.latitude), lon: String(coordinates.longitude), limit: '1', lang: LANGUAGE,
    });
    if (!results.length) throw new GeocodingError('not_found', 'Endereço não localizado.', 422);
    const [first] = results;
    return { latitude: first.latitude, longitude: first.longitude, address: first.address, responseHash: first.responseHash };
  }
}
