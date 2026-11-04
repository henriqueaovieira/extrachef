import type { NextRequest } from 'next/server';
import { authorizeRestaurantRequest } from '@/lib/locations/server';
import { lookupPostalCode, PostalCodeError } from '@/lib/postal-code';

export async function GET(request: NextRequest, { params }: { params: Promise<{ cep: string }> }) {
  const context = await authorizeRestaurantRequest(request, 'postal_code');
  if (!context.ok) return context.response;
  const { cep } = await params;
  try {
    return context.reply({ address: await lookupPostalCode(cep) }, 200);
  } catch (error) {
    const failure = error instanceof PostalCodeError
      ? error : new PostalCodeError('unavailable', 'Não foi possível consultar o CEP agora.', 503);
    console.warn('postal_code', { requestId: context.requestId, event: 'lookup_failed', code: failure.code });
    return context.reply({ error: failure.message, code: failure.code }, failure.status);
  }
}
