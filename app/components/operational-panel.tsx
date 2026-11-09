'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, LoadingSkeleton, TextInput, Toast } from '@/app/components/ui';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { createClient } from '@/lib/supabase/client';
import { phaseLabels, readOperationalContext, type OperationalContext } from '@/lib/operations';
import { getDeviceCoordinates } from '@/lib/geolocation';
import ProfessionalVerification from '@/app/components/professional-verification';
import OperationFlow from '@/app/components/operation-flow';

const phaseTones: Record<string, ComponentProps<typeof Badge>['tone']> = {
  confirmed: 'info', checkin: 'warning', absence_pending: 'warning', working: 'info',
  payment: 'warning', receipt: 'warning', payment_disputed: 'danger', checkout: 'warning',
  completed: 'success', cancelled: 'neutral', absent: 'danger', abandoned: 'danger',
};

export default function OperationalPanel({ jobId }: { jobId: string }) {
  const [supabase] = useState(() => createClient());
  const [context, setContext] = useState<OperationalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [interruption, setInterruption] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const { data, error } = await supabase.rpc('operational_context', { p_job_id: jobId });
        if (error) throw new Error(error.message);
        const value = readOperationalContext(data);
        if (active) { setContext(value); setError(''); }
      } catch (error) {
        if (active) {
          setContext(null);
          setError(error instanceof Error ? error.message : 'Não foi possível carregar a operação.');
        }
      } finally {
        refreshing = false;
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 15_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [jobId, retry, supabase]);

  const mutate = async (rpc: string, args: Record<string, string>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const parameters: Record<string, string | number> = { p_job_id: jobId, ...args };
      if (rpc === 'issue_operational_code' && args.p_stage === 'checkin') {
        const coordinates = await getDeviceCoordinates();
        const { data: session, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session.session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
        const response = await fetch('/api/checkin', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ jobId, ...coordinates }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error ?? 'Não foi possível validar sua localização.');
        setContext(readOperationalContext(result));
        setCode('');
        const streetNotice = result.location_precision === 'street'
          ? ' Seu check-in ajudará a melhorar a precisão deste local.' : '';
        setNotice(`Presença validada. Código operacional liberado.${streetNotice}`);
        return;
      }
      const { data, error } = await supabase.rpc(rpc, parameters);
      if (error) throw new Error(error.message);
      if (rpc === 'interrupt_operational_assignment') {
        if (typeof data !== 'string') throw new Error('O serviço não confirmou a ocorrência.');
        setNotice('Ocorrência registrada. O restaurante deve decidir entre encerrar a operação ou buscar substituto entre os candidatos já vinculados.');
        setInterruption(null);
        setRetry((value) => value + 1);
      } else {
        setContext(readOperationalContext(data));
        setCode('');
        setNotice(rpc === 'issue_operational_code' ? 'Presença validada. Código operacional liberado.'
          : rpc === 'validate_operational_code' ? args.p_stage === 'checkin' ? 'Check-in confirmado.' : 'Checkout realizado.'
          : args.p_action === 'paid' ? 'Pagamento informado. Aguardando confirmação do profissional.'
          : args.p_action === 'received' ? 'Recebimento confirmado. Checkout liberado.'
          : 'Empresa avisada. O checkout permanece bloqueado.');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível registrar esta etapa.');
    } finally { setBusy(false); }
  };

  const worker = context?.role === 'worker';
  const arriving = context && ['checkin', 'absence_pending'].includes(context.phase);
  const checkout = context?.phase === 'checkout';
  const issuer = Boolean((arriving && worker) || (checkout && !worker));
  const validCode = context?.code && context.code_expires_at && new Date(context.code_expires_at).getTime() > now;
  const stage = arriving ? 'checkin' : 'checkout';
  const ended = context && new Date(context.ends_at).getTime() <= now;
  const payment = context && ['payment', 'receipt', 'payment_disputed'].includes(context.phase);
  const returnHref = context?.role === 'restaurant' ? `/restaurant/demands/${context.demand_id}#hired-heading` : '/worker/applications';
  const canCancel = context && ['confirmed', 'checkin', 'absence_pending'].includes(context.phase);

  return (
    <main className="ec-operations-experience min-h-screen bg-gray-50 px-4 py-6 pb-28">
      <section className="mx-auto min-w-0 max-w-xl space-y-6">
        <Link href={returnHref} className="inline-flex min-h-11 items-center text-sm font-semibold">← {worker ? 'Minhas operações' : 'Voltar à operação'}</Link>
        <h1 className="text-2xl font-semibold">Operação ExtraChef</h1>
        {error && <Toast tone="danger"><p>{error}</p><Button variant="ghost" className="px-0 underline" onClick={() => setRetry((value) => value + 1)}>Atualizar operação</Button></Toast>}
        {notice && <Toast tone={context && ['checkout', 'completed'].includes(context.phase) ? 'success' : 'info'}>{notice}</Toast>}
        {loading ? <LoadingSkeleton label="Carregando operação..." /> : context && (
          <Card as="article" className="ec-operational-panel space-y-4">
            <Badge role={phaseTones[context.phase] === 'danger' ? 'alert' : 'status'} tone={phaseTones[context.phase] ?? 'neutral'} className="ec-operation-status">{context.phase === 'checkout' ? 'Checkout pendente · recebimento confirmado' : context.phase === 'payment' ? 'Pagamento pendente' : context.phase === 'confirmed' ? 'Equipe confirmada' : phaseLabels[context.phase] ?? context.phase}</Badge>
            <p className="text-sm font-semibold">Responsável: {context.phase === 'completed' ? 'Restaurante e profissional · avaliação' : context.phase === 'receipt' ? 'Profissional · confirmar recebimento' : context.phase === 'payment' || context.phase === 'payment_disputed' ? 'Restaurante · confirmar pagamento' : checkout ? 'Restaurante gera código; profissional valida checkout' : arriving ? 'Profissional apresenta código; restaurante confirma chegada' : 'Restaurante e profissional · acompanhar agenda'}</p>
            <div>
              <h2 className="break-words text-xl font-semibold">{context.title}</h2>
              {!worker && <p className="mt-2 flex flex-wrap items-center text-sm font-medium">{context.worker_name}<ProfessionalVerification jobId={jobId} /></p>}
              <p className="mt-2 text-sm text-gray-600">{context.location}</p>
              <p className="mt-2 text-sm text-gray-600">Agenda: {new Date(context.starts_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} — {new Date(context.ends_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</p>
            </div>
            {context.phase === 'confirmed' && <p className="text-sm text-gray-600">{worker ? 'No dia da operação, realize o check-in ao chegar.' : 'No dia da operação, confirme o check-in com o código apresentado pelo profissional.'}</p>}
            {context.phase === 'working' && !ended && <p className="text-sm text-gray-600">O trabalho está em andamento. Ao final do horário, o pagamento será a próxima etapa.</p>}
            {arriving && <p className="text-sm text-gray-600">{worker ? 'Apresente seu código à empresa. Ela confirma sua chegada digitando o código no aplicativo dela.' : 'Confira a chegada e digite o código apresentado pelo profissional. Um atraso não é uma ausência confirmada.'}</p>}
            {arriving && worker && !validCode && <p className="text-sm text-gray-600">Ative a localização precisa e esteja no local da operação. O raio é de até 300 metros para endereços aproximados e 100 metros para os demais. Não há rastreamento contínuo.</p>}
            {arriving && worker && context.location_precision === 'street' && <p className="text-sm text-gray-600">Seu check-in ajudará a melhorar a precisão deste local.</p>}
            {checkout && <p className="text-sm text-gray-600">{worker ? 'Solicite o código à empresa e digite abaixo para concluir.' : 'Informe este código ao profissional. Somente ele pode validar o checkout.'}</p>}
            {(arriving || checkout) && (issuer ? (
              <div className="space-y-3">
                {validCode ? <div role="status" className="ec-operational-panel__code">
                  <p className="text-xs text-gray-600">Código de {arriving ? 'Check-in' : 'Checkout'}</p>
                  <p className="mt-2 select-all break-all font-mono text-2xl font-bold tracking-widest sm:text-3xl">{context.code}</p>
                  <p className="mt-2 text-xs text-gray-500">Válido até {new Date(context.code_expires_at!).toLocaleTimeString('pt-BR')}.</p>
                </div> : <Button variant="primary" busy={busy} onClick={() => void mutate('issue_operational_code', { p_stage: stage })} className="w-full px-4">{arriving ? 'Realizar Check-in' : 'Gerar código de Checkout'}</Button>}
                {arriving && validCode && <p className="text-sm text-gray-600">Aguardando a empresa confirmar sua chegada.</p>}
              </div>
            ) : (
              <form onSubmit={(event) => { event.preventDefault(); void mutate('validate_operational_code', { p_stage: stage, p_code: code }); }} className="space-y-3">
                <label className="block text-sm font-medium">Código informado {arriving ? 'pelo profissional' : 'pela empresa'}
                  <TextInput id="operational-code" required minLength={8} maxLength={8} autoComplete="off" autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} className="mt-2 font-mono uppercase" />
                </label>
                <Button type="submit" variant="primary" busy={busy} className="w-full px-4">{arriving ? 'Confirmar Check-in' : 'Realizar Checkout'}</Button>
              </form>
            ))}
            {!worker && context.phase === 'absence_pending' && <div className="ec-operational-panel__warning space-y-3">
              <p className="text-sm">O horário passou da tolerância. Confira a chegada antes de registrar uma ausência.</p>
              <div className="flex flex-wrap gap-3">
                <Button disabled={busy} onClick={() => setInterruption('absent')} className="px-3 text-sm">Confirmar Ausência</Button>
                <Button disabled={busy} onClick={(event) => event.currentTarget.closest('article')?.querySelector<HTMLInputElement>('#operational-code')?.focus()} className="px-3 text-sm">Registrar Check-in Tardio</Button>
              </div>
            </div>}
            {payment && <div className="space-y-4">
              <p className="text-base font-medium tabular-nums text-gray-700">{Number(context.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
              {!worker ? <>
                <p className="text-sm text-gray-600">{context.phase === 'payment_disputed' ? 'O profissional informou que não recebeu. Confira e regularize o pagamento.' : context.paid_at ? 'Pagamento informado. Aguardando o profissional confirmar recebimento.' : 'Pagamento pendente. Pague o profissional fora do aplicativo e registre abaixo.'}</p>
                {(!context.paid_at || context.phase === 'payment_disputed') && <Button variant="primary" busy={busy} onClick={() => void mutate('record_operational_payment', { p_action: 'paid' })} className="w-full px-4">Confirmar Pagamento</Button>}
              </> : context.paid_at ? <>
                <p className="text-sm font-medium">Você recebeu o pagamento?</p>
                <p className="text-xs text-gray-500">Confirme apenas após conferir o recebimento. Essa confirmação libera o checkout.</p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button disabled={busy || context.phase === 'payment_disputed'} onClick={() => void mutate('record_operational_payment', { p_action: 'not_received' })} className="flex-1 px-4">Não Recebi</Button>
                  <Button variant="primary" busy={busy} onClick={() => void mutate('record_operational_payment', { p_action: 'received' })} className="flex-1 px-4">Confirmar Recebimento</Button>
                </div>
              </> : <p className="text-sm text-gray-600">Aguardando pagamento. O checkout será liberado somente após você confirmar recebimento.</p>}
            </div>}
            {context.phase === 'completed' && <div className="space-y-3">
              <p className="text-sm text-gray-600">O encerramento foi registrado. Você pode avaliar depois, mas precisa avaliar antes da próxima {worker ? 'candidatura' : 'operação'}.</p>
              <Link href={`/reviews/${jobId}`} className="ec-button ec-button--primary w-full px-4">{context.review_pending ? 'Avaliar experiência' : 'Ver avaliação'}</Link>
            </div>}
            <OperationFlow jobId={jobId} role={context.role} hired assignment={context}
              startsAt={new Date(context.starts_at)} endsAt={new Date(context.ends_at)} now={new Date(now)} phase={context.phase} showAction={false} />
            {(context.checkin_at || context.receipt_confirmed_at || context.checkout_at) && <dl className="space-y-2 border-t border-gray-100 pt-4 text-xs text-gray-600">
              {([['Check-in realizado', context.checkin_at], ['Pagamento confirmado', context.receipt_confirmed_at], ['Checkout realizado', context.checkout_at]] as const).map(([label, date]) => date && <div key={label}><dt className="font-semibold">{label}</dt><dd>{new Date(date).toLocaleString('pt-BR')}</dd></div>)}
            </dl>}
            {((canCancel && worker) || (!worker && (canCancel || context.phase === 'working'))) && <details className="border-t border-gray-100 pt-3">
              <summary className="min-h-12 cursor-pointer content-center text-sm font-medium text-gray-600">Registrar imprevisto</summary>
              <div className="space-y-3 pt-3">
                {canCancel && <Button disabled={busy} onClick={() => setInterruption('cancelled')} className="px-3 text-sm">{worker ? 'Cancelar minha participação' : 'Registrar cancelamento do profissional'}</Button>}
                {!worker && context.phase === 'working' && <Button disabled={busy} onClick={() => setInterruption('abandoned')} className="px-3 text-sm">Registrar abandono</Button>}
              </div>
            </details>}
            {interruption && <div role="alert" className="ec-operational-panel__danger space-y-3">
              <p className="text-sm">Confirmar {interruption === 'absent' ? 'ausência' : interruption === 'abandoned' ? 'abandono' : 'cancelamento'}? Esta ocorrência será registrada no histórico. O recrutamento não será reaberto.</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button variant="danger" busy={busy} onClick={() => void mutate('interrupt_operational_assignment', { p_reason: interruption })} className="px-3">Confirmar ocorrência</Button>
              <Button disabled={busy} onClick={() => setInterruption(null)} className="px-3">Voltar</Button>
              </div>
            </div>}
          </Card>
        )}
      </section>
      {context && <MobileBottomNav role={context.role} />}
    </main>
  );
}
