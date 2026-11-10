'use client';

import { useEffect, useState } from 'react';

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  actor_user_id: string | null;
  target_user_id: string | null;
};

type AuditPage = { events: AuditRow[]; next_cursor: string | null };
type QueryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; page: AuditPage };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsePage(value: unknown): AuditPage {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > 50
    || !(value.next_cursor === null
      || (typeof value.next_cursor === 'string' && value.next_cursor.length > 0))) {
    throw new Error('Invalid audit response');
  }
  const events: AuditRow[] = value.events.map((event: unknown) => {
    if (!isRecord(event)
      || typeof event.id !== 'string'
      || typeof event.created_at !== 'string'
      || !Number.isFinite(Date.parse(event.created_at))
      || typeof event.action !== 'string'
      || !(event.actor_user_id === null || typeof event.actor_user_id === 'string')
      || !(event.target_user_id === null || typeof event.target_user_id === 'string')) {
      throw new Error('Invalid audit event');
    }
    return {
      id: event.id,
      created_at: event.created_at,
      action: event.action,
      actor_user_id: event.actor_user_id,
      target_user_id: event.target_user_id,
    };
  });
  if (events.length === 0 && value.next_cursor !== null) {
    throw new Error('Invalid empty audit page');
  }
  return { events, next_cursor: value.next_cursor };
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'UTC',
});

const buttonClass = 'rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50';

export default function AuditClient() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<QueryState>({ status: 'loading' });
  const cursor = cursors[cursors.length - 1];

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`/api/admin/audit?${params}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setState({
              status: 'error',
              message: response.status === 401
                ? 'Sua sessão expirou. Entre novamente para consultar a trilha.'
                : response.status === 403
                  ? 'Você não tem permissão para consultar a trilha administrativa.'
                  : 'Não foi possível carregar a trilha administrativa.',
            });
          }
          return;
        }
        const payload: unknown = await response.json();
        const page = parsePage(payload);
        if (!controller.signal.aborted) setState({ status: 'ready', page });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('admin_audit_ui_load_failed', {
          type: error instanceof Error ? error.name : 'UnknownError',
        });
        setState({ status: 'error', message: 'Não foi possível carregar a trilha administrativa.' });
      }
    }
    void load();
    return () => controller.abort();
  }, [cursor, attempt]);

  function navigate(nextCursors: (string | null)[]) {
    setState({ status: 'loading' });
    setCursors(nextCursors);
  }

  return (
    <div className="space-y-4" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && (
        <p role="status" className="text-sm text-stone-600">Carregando trilha administrativa…</p>
      )}
      {state.status === 'error' && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-red-700">{state.message}</p>
          <button type="button" className={buttonClass} onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}>
            Tentar novamente
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          {state.page.events.length === 0 ? (
            <p role="status" className="text-sm text-stone-600">Nenhum evento encontrado nesta página.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-stone-700">
                <caption className="sr-only">Eventos administrativos em ordem decrescente de data</caption>
                <thead className="border-b border-stone-200">
                  <tr>
                    <th scope="col" aria-sort="descending" className="px-3 py-3">Data (UTC)</th>
                    <th scope="col" className="px-3 py-3">Ação</th>
                    <th scope="col" className="px-3 py-3">Ator</th>
                    <th scope="col" className="px-3 py-3">Alvo</th>
                    <th scope="col" className="px-3 py-3">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {state.page.events.map((event) => (
                    <tr key={event.id} className="border-b border-stone-100 align-top">
                      <td className="whitespace-nowrap px-3 py-3">
                        <time dateTime={event.created_at}>{dateFormatter.format(new Date(event.created_at))}</time>
                      </td>
                      <td className="break-words px-3 py-3">{event.action}</td>
                      <td className="break-all px-3 py-3">{event.actor_user_id ?? 'Não informado'}</td>
                      <td className="break-all px-3 py-3">{event.target_user_id ?? 'Não informado'}</td>
                      <td className="px-3 py-3">Não disponibilizado nesta consulta</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav aria-label="Paginação da trilha administrativa" className="flex flex-wrap items-center gap-3">
            <button type="button" className={buttonClass} disabled={cursors.length === 1}
              onClick={() => navigate(cursors.slice(0, -1))}>
              Anterior
            </button>
            <span className="text-sm text-stone-600">Página {cursors.length}</span>
            <button type="button" className={buttonClass} disabled={state.page.next_cursor === null}
              onClick={() => {
                if (state.page.next_cursor) navigate([...cursors, state.page.next_cursor]);
              }}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
