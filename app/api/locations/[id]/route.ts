import type { NextRequest } from 'next/server';
import {
  authorizeRestaurantRequest, locateSavedLocation, parseLocationInput, rpcStatus, saveAndLocate,
} from '@/lib/locations/server';
import { catalogLocationColumns, parseLocation } from '@/lib/work-locations';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await authorizeRestaurantRequest(request, 'locations');
  if (!context.ok) return context.response;
  const { id } = await params;
  if (!uuid.test(id)) return context.reply({ error: 'Local não encontrado.' }, 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return context.reply({ error: 'Dados do local inválidos.' }, 400);
  }
  if (!body || typeof body !== 'object') return context.reply({ error: 'Dados do local inválidos.' }, 400);

  if (Reflect.get(body, 'action') === 'locate') {
    const { data, error } = await context.supabase.from('work_locations')
      .select(catalogLocationColumns).eq('id', id).maybeSingle();
    if (error) return context.reply({ error: 'Não foi possível carregar o local.' }, rpcStatus(error.code));
    if (!data) return context.reply({ error: 'Local não encontrado.' }, 404);
    const result = await locateSavedLocation(context, parseLocation(data));
    return context.reply(result.body, result.status);
  }

  const revision = Reflect.get(body, 'revision');
  if (typeof revision !== 'number' || !Number.isInteger(revision)) {
    return context.reply({ error: 'Recarregue o local antes de editar.' }, 400);
  }
  let input;
  try {
    input = parseLocationInput(Reflect.get(body, 'location'));
  } catch (error) {
    return context.reply({ error: error instanceof Error ? error.message : 'Dados do local inválidos.' }, 400);
  }
  const result = await saveAndLocate(context, input, { id, revision });
  return context.reply(result.body, result.status);
}
