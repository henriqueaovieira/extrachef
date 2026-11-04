'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getVerificationRequirements, getVerificationState, type VerificationProfile } from '@/lib/profile-verification';
import CameraCapture from '@/app/components/camera-capture';
import VerifiedProfileBadge from '@/app/components/verified-profile-badge';
import { Button, Toast } from '@/app/components/ui';

export default function ProfileVerification({ profile, onSubmitted }: {
  profile: VerificationProfile;
  onSubmitted: (path: string) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [capturing, setCapturing] = useState(false);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = getVerificationState(profile);
  const requirements = getVerificationRequirements(profile);
  const eligible = requirements.every((item) => item.complete);

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const submit = async () => {
    if (!selfie || busy) return;
    setBusy(true);
    setError('');
    let uploadedPath: string | null = null;
    let submitted = false;
    try {
      if (selfie.type !== 'image/jpeg' || selfie.size > 10 * 1024 * 1024 || selfie.size === 0) {
        throw new Error('Capture uma selfie JPEG de até 10 MB.');
      }
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error('Entre na sua conta para enviar a selfie.');
      const path = `${auth.user.id}/selfie-${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('worker-private').upload(path, selfie, {
        contentType: 'image/jpeg', upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      uploadedPath = path;
      const { error: submissionError } = await supabase.rpc('submit_own_profile_verification', { p_selfie_path: path });
      if (submissionError) throw new Error(submissionError.message);
      submitted = true;
      onSubmitted(path);
      setSelfie(null);
      setPreview('');
      setCapturing(false);
      if (profile.selfie_verification_path) {
        const { error: removalError } = await supabase.storage.from('worker-private').remove([profile.selfie_verification_path]);
        if (removalError) throw new Error('A nova selfie está em análise, mas não foi possível excluir a foto substituída. Contate o suporte.');
      }
    } catch (failure) {
      let message = failure instanceof Error ? failure.message : 'Não foi possível enviar a verificação.';
      if (uploadedPath && !submitted) {
        const { error: cleanupError } = await supabase.storage.from('worker-private').remove([uploadedPath]);
        if (cleanupError) message += ' Não foi possível limpar o upload incompleto. Contate o suporte.';
      }
      setError(message);
    } finally { setBusy(false); }
  };

  return (
    <section id="verification" className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <h3 className="font-semibold text-gray-950">Perfil Verificado {state === 'verified' && <VerifiedProfileBadge />}</h3>
      {state === 'verified' ? <p className="text-sm text-gray-600">Sua identidade foi validada pelo ExtraChef.</p>
        : state === 'pending' ? <div role="status"><p className="font-medium">Verificação em análise</p><p className="mt-1 text-sm text-gray-600">Sua identidade está sendo revisada.</p></div>
        : <>
          <div role="status">
            <p className="font-medium">{state === 'rejected' ? 'Revisão necessária' : 'Perfil não verificado'}</p>
            <p className="mt-1 text-sm text-gray-600">{state === 'rejected'
              ? 'Precisamos de uma nova foto para concluir a validação.'
              : 'Confirme sua identidade para obter o selo de Perfil Verificado.'}</p>
          </div>
          <ul className="space-y-1 text-sm text-gray-700">
            {requirements.map((item) => <li key={item.label}>{item.complete ? '✓' : '□'} {item.label}</li>)}
            <li>{selfie ? '✓' : '□'} Selfie de verificação</li>
          </ul>
          {!eligible && <Link href="/worker/profile?edit=1" className="inline-flex min-h-11 items-center font-semibold text-orange-700">Preencher CPF, RG e telefone</Link>}
          <p className="text-xs text-gray-600">A selfie é usada exclusivamente para validação pelo ExtraChef e não é exibida a restaurantes ou outros profissionais. <Link href="/privacy" className="underline">Política de privacidade</Link></p>
          {!capturing ? <Button type="button" variant="primary" disabled={!eligible} onClick={() => setCapturing(true)}>
            {state === 'rejected' ? 'Enviar nova selfie' : 'Verificar Perfil'}
          </Button> : selfie ? <div className="space-y-3">
            {preview && <Image src={preview} alt="Pré-visualização privada da selfie" width={240} height={320} unoptimized className="max-h-80 rounded-xl object-contain" />}
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="primary" busy={busy} disabled={busy} onClick={() => void submit()}>Confirmar e enviar selfie</Button>
              <Button type="button" disabled={busy} onClick={() => { setSelfie(null); setPreview(''); }}>Capturar novamente</Button>
              <Button type="button" disabled={busy} onClick={() => { setSelfie(null); setPreview(''); setCapturing(false); }}>Cancelar</Button>
            </div>
          </div> : <CameraCapture label="selfie de verificação" allowFileFallback={false} onCapture={(file) => {
            setSelfie(file);
            setPreview(URL.createObjectURL(file));
          }} />}
        </>}
      {error && <Toast tone="error">{error}</Toast>}
    </section>
  );
}
