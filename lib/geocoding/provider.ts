import 'server-only';
import { PhotonProvider } from './photon';
import { GeocodingError } from './types';

export function geocodingConfiguration() {
  // TEMP DEBUG: remove after geocoding configuration diagnosis.
  console.error('GEOCODING CONFIG ENTERED', {
    hasProvider: process.env.GEOCODING_PROVIDER !== undefined,
    hasEndpoint: process.env.GEOCODING_ENDPOINT !== undefined,
    hasTimeout: process.env.GEOCODING_TIMEOUT !== undefined,
    hasTtl: process.env.GEOCODING_CACHE_TTL !== undefined,
    vercelEnv: process.env.VERCEL_ENV,
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  const endpoint = process.env.GEOCODING_ENDPOINT?.trim();
  const timeout = Number(process.env.GEOCODING_TIMEOUT);
  const ttl = Number(process.env.GEOCODING_CACHE_TTL);
  if (process.env.GEOCODING_PROVIDER !== 'photon' || !endpoint
    || !Number.isInteger(timeout) || timeout < 1000 || timeout > 30000
    || !Number.isInteger(ttl) || ttl < 60 || ttl > 7776000) {
    console.error('GEOCODING CONFIG DEBUG', {
      provider: process.env.GEOCODING_PROVIDER,
      providerJson: JSON.stringify(process.env.GEOCODING_PROVIDER),
      endpoint: process.env.GEOCODING_ENDPOINT,
      timeout: process.env.GEOCODING_TIMEOUT,
      ttl: process.env.GEOCODING_CACHE_TTL,
    });
    // TEMP DEBUG: remove after geocoding configuration diagnosis.
    console.error({
      providerRaw: process.env.GEOCODING_PROVIDER,
      providerJson: JSON.stringify(process.env.GEOCODING_PROVIDER),

      endpointRaw: process.env.GEOCODING_ENDPOINT,
      endpointJson: JSON.stringify(process.env.GEOCODING_ENDPOINT),

      timeoutRaw: process.env.GEOCODING_TIMEOUT,
      timeoutJson: JSON.stringify(process.env.GEOCODING_TIMEOUT),

      ttlRaw: process.env.GEOCODING_CACHE_TTL,
      ttlJson: JSON.stringify(process.env.GEOCODING_CACHE_TTL),
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
