'use client';

import { useEffect, useState } from 'react';

type StaffMember = {
  id: string;
  user_id: string;
  staff_role: string;
  status: string;
};

function isStaffMember(value: unknown): value is StaffMember {
  return value !== null && typeof value === 'object'
    && 'id' in value && typeof value.id === 'string'
    && 'user_id' in value && typeof value.user_id === 'string'
    && 'staff_role' in value && typeof value.staff_role === 'string'
    && 'status' in value && typeof value.status === 'string';
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; members: StaffMember[] };

export default function StaffClient() {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/admin/staff?limit=50&offset=${offset}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Staff request failed');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('staff' in body)
          || !Array.isArray(body.staff) || !body.staff.every(isStaffMember)) {
          throw new Error('Invalid staff response');
        }
        if (!controller.signal.aborted) setState({ status: 'ready', members: body.staff });
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('staff_ui_load_failed', {
          type: error instanceof Error ? error.name : 'UnknownError',
        });
        setState({ status: 'error' });
      }
    }
    void load();
    return () => controller.abort();
  }, [offset, attempt]);

  function navigate(nextOffset: number) {
    setState({ status: 'loading' });
    setOffset(nextOffset);
  }

  if (state.status === 'loading') return <p role="status">Carregando membros Staff…</p>;
  if (state.status === 'error') {
    return (
      <div className="space-y-3">
        <p role="alert">Não foi possível carregar os membros Staff.</p>
        <button type="button" className="rounded-lg border px-3 py-2" onClick={() => {
          setState({ status: 'loading' });
          setAttempt((value) => value + 1);
        }}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {state.members.length === 0 ? <p role="status">Nenhum membro encontrado nesta página.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-stone-700">
            <caption className="sr-only">Membros Staff</caption>
            <thead>
              <tr>
                <th scope="col" className="px-3 py-3">Usuário</th>
                <th scope="col" className="px-3 py-3">Papel</th>
                <th scope="col" className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {state.members.map((member) => (
                <tr key={member.id} className="border-t border-stone-200">
                  <td className="break-all px-3 py-3">{member.user_id}</td>
                  <td className="px-3 py-3">{member.staff_role}</td>
                  <td className="px-3 py-3">{member.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Paginação de Staff" className="flex items-center gap-3">
        <button type="button" disabled={offset === 0}
          className="rounded-lg border px-3 py-2 disabled:opacity-50"
          onClick={() => navigate(Math.max(0, offset - 50))}>Anterior</button>
        <span>Página {offset / 50 + 1}</span>
        <button type="button" disabled={state.members.length < 50}
          className="rounded-lg border px-3 py-2 disabled:opacity-50"
          onClick={() => navigate(offset + 50)}>Próxima</button>
      </nav>
    </div>
  );
}
