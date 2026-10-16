'use client';

import { useEffect, useState } from 'react';

export default function DevicePermissions() {
  const [states, setStates] = useState({ notifications: 'Consultando', location: 'Sob demanda', camera: 'Sob demanda' });
  useEffect(() => {
    let active = true;
    const listeners: Array<{ permission: PermissionStatus; handler: () => void }> = [];
    const labels: Record<string, string> = { granted: 'Permitido', denied: 'Bloqueado', prompt: 'Ainda não solicitado' };
    async function inspect() {
      if (active) setStates((current) => ({ ...current, notifications: typeof Notification !== 'undefined' ? labels[Notification.permission] || 'Ainda não solicitado' : 'Indisponível' }));
      for (const [key, name] of [['location', 'geolocation'], ['camera', 'camera']] as const) {
        try {
          if (!navigator.permissions) continue;
          const permission = await navigator.permissions.query({ name: name as PermissionName });
          if (!active) return;
          const handler = () => { if (active) setStates((current) => ({ ...current, [key]: labels[permission.state] })); };
          handler(); permission.addEventListener('change', handler); listeners.push({ permission, handler });
        } catch { /* Unsupported permission introspection does not request access. */ }
      }
    }
    void inspect();
    return () => { active = false; listeners.forEach(({ permission, handler }) => permission.removeEventListener('change', handler)); };
  }, []);
  return <section className="rounded-xl border border-gray-200 bg-white p-4">
    <h2 className="font-semibold text-gray-900">Permissões deste dispositivo</h2>
    <dl className="mt-3 space-y-3 text-sm">
      <div className="flex justify-between gap-3"><dt>Notificações</dt><dd>{states.notifications}</dd></div>
      <div className="flex justify-between gap-3"><dt>Localização</dt><dd>{states.location}</dd></div>
      <div className="flex justify-between gap-3"><dt>Câmera</dt><dd>{states.camera}</dd></div>
      <div className="flex justify-between gap-3"><dt>Arquivos</dt><dd>Apenas os selecionados por você</dd></div>
    </dl>
  </section>;
}