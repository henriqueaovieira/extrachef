import 'server-only';
import { PhotonProvider } from './photon';
import { GeocodingError } from './types';

export function geocodingConfiguration() {
  const endpoint = process.env.GEOCODING_ENDPOINT?.trim();
  const timeout = Number(process.env.GEOCODING_TIMEOUT);
  const ttl = Number(process.env.GEOCODING_CACHE_TTL);
  if (process.env.GEOCODING_PROVIDER !== 'photon' || !endpoint
    || !Number.isInteger(timeout) || timeout < 1000 || timeout > 30000
    || !Number.isInteger(ttl) || ttl < 60 || ttl > 7776000) {
    console.error('GEOCODING CONFIG DEBUG', {
      provider: process.env.GEOCODING_PROVIDER,
      endpoint: process.env.GEOCODING_ENDPOINT,
      timeout: process.env.GEOCODING_TIMEOUT,
      ttl: process.env.GEOCODING_CACHE_TTL,
    });
    throw new GeocodingError('configuration', 'Configuração do serviço de geocodificação ausente ou inválida.');
  }
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new GeocodingError('configuration', 'URL do serviço de geocodificação inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new GeocodingError('configuration', 'O serviço de geocodificação exige uma URL HTTPS sem credenciais.');
  }
  return { endpoint: url.toString().replace(/\/+$/, ''), timeout, ttl };
}

export function createGeocodingProvider(config: ReturnType<typeof geocodingConfiguration>) {
  return new PhotonProvider(config.endpoint, config.timeout);
}
