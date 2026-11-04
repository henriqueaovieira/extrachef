import type { NextRequest } from 'next/server';
import { authorizeRestaurantRequest, parseLocationInput, saveAndLocate } from '@/lib/locations/server';

export async function POST(request: NextRequest) {
  const context = await authorizeRestaurantRequest(request, 'locations');
  if (!context.ok) return context.response;
  let input;
  try {
    input = parseLocationInput(await request.json());
  } catch (error) {
    return context.reply({ error: error instanceof Error ? error.message : 'Dados do local inválidos.' }, 400);
  }
  const result = await saveAndLocate(context, input, null);
  return context.reply(result.body, result.status);
}
