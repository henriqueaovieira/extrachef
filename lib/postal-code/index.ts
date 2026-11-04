import 'server-only';

export interface PostalCodeAddress {
  postal_code: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
}

export class PostalCodeError extends Error {
  constructor(public readonly code: 'invalid' | 'not_found' | 'unavailable', message: string, public readonly status: number) {
    super(message);
    this.name = 'PostalCodeError';
  }
}

export function postalCodeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const endpoint = (env.POSTAL_CODE_ENDPOINT?.trim() || 'https://viacep.com.br/ws').replace(/\/+$/, '');
  const timeout = Number(env.POSTAL_CODE_TIMEOUT?.trim() || 4000);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PostalCodeError('unavailable', 'Consulta de CEP indisponível.', 503);
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new PostalCodeError('unavailable', 'Consulta de CEP indisponível.', 503);
  }
  if (!Number.isInteger(timeout) || timeout < 500 || timeout > 15000) {
    throw new PostalCodeError('unavailable', 'Consulta de CEP indisponível.', 503);
  }
  return { endpoint, timeout };
}

const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** ViaCEP-compatible lookup: GET {endpoint}/{cep}/json/. Only fills the form; coordinates come from geocoding. */
export async function lookupPostalCode(
  cep: string,
  fetcher: typeof fetch = fetch,
  config = postalCodeConfiguration(),
): Promise<PostalCodeAddress> {
  const digits = cep.replace(/\D/g, '');
  if (!/^\d{8}$/.test(digits)) throw new PostalCodeError('invalid', 'Informe um CEP válido com 8 dígitos.', 400);
  let response: Response;
  try {
    response = await fetcher(`${config.endpoint}/${digits}/json/`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeout),
      cache: 'no-store',
    });
  } catch {
    throw new PostalCodeError('unavailable', 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.', 503);
  }
  if (response.status === 400 || response.status === 404) throw new PostalCodeError('not_found', 'CEP não encontrado.', 404);
  if (!response.ok) {
    throw new PostalCodeError('unavailable', 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.', 503);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new PostalCodeError('unavailable', 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.', 503);
  }
  if (Reflect.get(body, 'erro') === true || Reflect.get(body, 'erro') === 'true') {
    throw new PostalCodeError('not_found', 'CEP não encontrado.', 404);
  }
  const state = text(Reflect.get(body, 'uf'), 2).toUpperCase();
  const city = text(Reflect.get(body, 'localidade'), 120);
  if (!/^[A-Z]{2}$/.test(state) || !city) throw new PostalCodeError('not_found', 'CEP não encontrado.', 404);
  return {
    postal_code: digits,
    address: text(Reflect.get(body, 'logradouro'), 300),
    neighborhood: text(Reflect.get(body, 'bairro'), 120),
    city,
    state,
  };
}
