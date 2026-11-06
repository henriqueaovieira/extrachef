'use client';

import Link from 'next/link';
import type { ComponentProps } from 'react';
import { Badge, Card } from '@/app/components/ui';
import { getOperationFlow, type OperationFlowInput } from '@/lib/operations';

export default function OperationFlow(props: OperationFlowInput & { showChat?: boolean; showAction?: boolean }) {
  const flow = getOperationFlow(props);
  const interruption = props.assignment?.interruption || props.phase;
  const statusTone: ComponentProps<typeof Badge>['tone'] = ['absent', 'abandoned'].includes(interruption ?? '') ? 'danger'
    : props.hired && !props.assignment ? 'danger' : interruption === 'cancelled' ? 'neutral'
      : flow.steps[5].state === 'done' ? 'success'
        : props.phase === 'payment_disputed' || props.assignment?.payment_disputed_at ? 'danger'
          : props.phase === 'confirmed' || (flow.steps[2].state === 'done' && props.now < props.endsAt) ? 'info' : 'warning';
  return <Card aria-label="Fluxo operacional" className="ec-operation-flow space-y-4">
    <div>
      <Badge role={statusTone === 'danger' ? 'alert' : 'status'} tone={statusTone} className="ec-operation-status">{flow.status}</Badge>
      <h3 className="mt-3 font-semibold text-gray-950">Etapas da operação</h3>
    </div>
    <dl className="ec-operation-flow__context space-y-3 text-sm">
      <div><dt className="text-xs text-gray-600">Responsável pela próxima etapa</dt><dd className="mt-1 font-semibold">{!props.hired ? 'Restaurante · contratação' : !props.assignment ? 'Estado indisponível · atualizar operação' : ['cancelled', 'absent', 'abandoned'].includes(interruption ?? '') ? 'Restaurante · acompanhar ocorrência' : flow.steps[5].state === 'done' ? 'Restaurante e profissional · avaliações' : flow.steps[2].state !== 'done' ? 'Profissional apresenta o código; restaurante confirma o check-in' : props.now < props.endsAt ? 'Restaurante e profissional · acompanhar operação' : flow.steps[3].state !== 'done' ? props.assignment.paid_at && !props.assignment.payment_disputed_at && props.phase !== 'payment_disputed' ? 'Profissional · confirmar recebimento' : 'Restaurante · confirmar pagamento' : 'Restaurante gera o código; profissional realiza o checkout'}</dd></div>
      <div><dt className="text-xs text-gray-600">Próxima ação para {props.role === 'restaurant' ? 'o restaurante' : 'o profissional'}</dt><dd className="mt-1 font-semibold">{flow.action?.label ?? (!props.hired ? 'Acompanhar contratação' : 'Conferir estado da operação')}</dd></div>
      <div><dt className="text-xs text-gray-600">Quando agir</dt><dd className="mt-1">{flow.steps[5].state === 'done' ? 'Após a conclusão · conferir avaliação' : props.now < props.endsAt ? <>Conforme a agenda{props.startsAt && <> · início {props.startsAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</>} · término {props.endsAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</> : 'Horário encerrado · conferir pendências agora'}</dd></div>
    </dl>
    <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap">
      {props.showAction !== false && flow.action && <Link href={flow.action.href} className="ec-button ec-button--primary px-4 text-sm">{flow.action.label}</Link>}
      {props.showChat !== false && (flow.chatHref
        ? <Link href={flow.chatHref} className="ec-button ec-button--secondary px-4 text-sm">Conversar sobre a operação</Link>
        : <p className="text-xs leading-5 text-gray-500">Chat bloqueado: disponível após a contratação, enquanto houver relacionamento operacional ativo.</p>)}
    </div>
    <ol className="space-y-0">
      {flow.steps.map((step, index) => <li key={step.label} aria-current={step.state === 'current' ? 'step' : undefined}
        data-state={step.state} data-stage={step.label} className="ec-operation-flow__step">
        <span aria-hidden="true" className="ec-operation-flow__marker">
          {step.state === 'done' ? '✓' : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">{step.label}</p>
            <Badge tone={step.state === 'done' ? 'success' : step.state === 'locked' ? 'neutral'
              : ['Check-in', 'Pagamento', 'Checkout'].includes(step.label) ? 'warning' : 'info'}>
              {step.state === 'done' ? 'Concluída' : step.state === 'current' ? 'Etapa atual' : 'Bloqueada'}
            </Badge>
          </div>
          {step.description && <p className="mt-1 text-xs leading-5 text-gray-600">{step.description}</p>}
        </div>
      </li>)}
    </ol>
  </Card>;
}
