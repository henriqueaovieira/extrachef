'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, LoadingSkeleton, Toast } from '@/app/components/ui';
import MobileBottomNav from '@/app/components/mobile-bottom-nav';
import { createClient } from '@/lib/supabase/client';
import { demandDate } from '@/lib/demands';

interface Invitation {
  id: string; title: string; job_date: string; start_time: string; end_time: string;
  value: number; location_name: string | null; status: string; created_at: string;
  can_accept: boolean; is_replacement: boolean; expires_at: string;
}

export default function WorkerInvitations() {
  const [supabase] = useState(() => createClient());
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true); setError('');
      try {
        const { data, error } = await supabase.rpc('worker_demand_invites');
        if (error) throw new Error(error.message);
        if (!data) throw new Error('O serviço não retornou seus convites.');
        if (mounted) setInvitations(data);
      } catch (error) {
        if (mounted) setError(error instanceof Error ? error.message : 'Não foi possível carregar os convites.');
      } finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, [retry, supabase]);
  const respond = async (invitation: Invitation, accept: boolean) => {
    if (busy) return;
    setBusy(invitation.id); setError(''); setNotice('');
    try {
      const { error } = await supabase.rpc('respond_demand_invitation', { p_invitation_id: invitation.id, p_accept: accept });
      if (error) throw new Error(error.message);
      setInvitations((current) => current.map((item) => item.id === invitation.id ? { ...item, status: accept ? 'accepted' : 'declined' } : item));
      setNotice(accept ? 'Convite aceito. Sua candidatura aguarda a aprovação da empresa.' : 'Convite recusado.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível responder ao convite.');
    } finally { setBusy(null); }
  };
  return (
    <main className="min-h-screen bg-[#fafaf9] px-5 py-8 pb-28">
      <section className="mx-auto max-w-2xl space-y-5">
        <Link href="/worker/applications" className="inline-flex min-h-11 items-center text-sm font-semibold">← Minhas candidaturas</Link>
        <h1 className="text-2xl font-semibold tracking-tight">Meus convites</h1>
        <p className="text-sm text-gray-500">Aceitar demonstra seu interesse. A contratação depende da aprovação da empresa.</p>
        {error && <Toast tone="error"><p>{error}</p><Button variant="ghost" onClick={() => setRetry((value) => value + 1)} className="px-0 underline">Tentar Novamente</Button></Toast>}
        {notice && <Toast tone="info">{notice}</Toast>}
        {loading ? <LoadingSkeleton label="Carregando convites..." /> : invitations.length ? invitations.map((invitation) => <article id={`invitation-${invitation.id}`} key={invitation.id} className="scroll-mt-6 space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold">{invitation.title}</h2>
          {invitation.is_replacement && <p className="text-sm font-medium">Convite de substituição · aguarda confirmação do restaurante após seu aceite.</p>}
          <p className="text-sm">{demandDate(invitation.job_date)} · {invitation.start_time.slice(0, 5)} às {invitation.end_time.slice(0, 5)}</p>
          <p className="text-sm text-gray-500">{invitation.location_name || 'Local a definir'} · {Number(invitation.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
          {invitation.status === 'pending' ? <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={busy !== null || !invitation.can_accept || now >= new Date(invitation.expires_at)} busy={busy === invitation.id} onClick={() => void respond(invitation, true)} className="px-4 text-sm">{invitation.can_accept && now < new Date(invitation.expires_at) ? 'Aceitar convite' : 'Convite encerrado'}</Button>
            <Button disabled={busy !== null} onClick={() => void respond(invitation, false)} className="px-4 text-sm">Recusar</Button>
          </div> : <p className="text-sm font-medium text-gray-600">{invitation.status === 'accepted' ? 'Convite aceito · confira suas candidaturas' : 'Convite recusado'}</p>}
        </article>) : !error ? <EmptyState title="Nenhum convite por enquanto." description="Os convites de empresas aparecerão aqui." /> : null}
      </section>
      <MobileBottomNav role="worker" />
    </main>
  );
}
