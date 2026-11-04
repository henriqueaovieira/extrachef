'use client';

import Link from 'next/link';
import { getOperationFlow, type OperationFlowInput } from '@/lib/operations';

export default function OperationFlow(props: OperationFlowInput & { showChat?: boolean; showAction?: boolean }) {
  const flow = getOperationFlow(props);
  return <section aria-label="Fluxo operacional" className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
    <div>
      <h3 className="font-semibold text-gray-950">Etapas da operação</h3>
      <p role="status" className="mt-1 text-sm text-gray-600">{flow.status}</p>
    </div>
    <ol className="space-y-0">
      {flow.steps.map((step, index) => <li key={step.label} aria-current={step.state === 'current' ? 'step' : undefined}
        className={`relative border-l-2 pb-4 pl-5 last:border-transparent last:pb-0 ${step.state === 'done' ? 'border-emerald-200' : 'border-gray-200'}`}>
        <span aria-hidden="true" className={`absolute -left-3 flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
          step.state === 'done' ? 'bg-emerald-100 text-emerald-800' : step.state === 'current' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-500'}`}>
          {step.state === 'done' ? '✓' : index + 1}
        </span>
        <p className={`text-sm font-semibold ${step.state === 'locked' ? 'text-gray-500' : 'text-gray-900'}`}>{step.label}
          <span className="ml-2 text-xs font-normal">{step.state === 'done' ? 'Concluída' : step.state === 'current' ? 'Etapa atual' : 'Bloqueada'}</span>
        </p>
        {step.description && <p className="mt-1 text-xs leading-5 text-gray-600">{step.description}</p>}
      </li>)}
    </ol>
    <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-3">
      {props.showAction !== false && flow.action && <Link href={flow.action.href} className="ec-button ec-button--primary px-4 text-sm">{flow.action.label}</Link>}
      {props.showChat !== false && (flow.chatHref
        ? <Link href={flow.chatHref} className="ec-button ec-button--secondary px-4 text-sm">Conversar</Link>
        : <p className="text-xs leading-5 text-gray-500">Chat bloqueado: disponível após a contratação, enquanto houver relacionamento operacional ativo.</p>)}
    </div>
  </section>;
}
