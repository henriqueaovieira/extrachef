export interface VerificationProfile {
  cpf: string;
  rg: string;
  phone: string;
  selfie_verification_path: string | null;
  verification_status: string;
}

export function getVerificationState(profile: VerificationProfile) {
  if (!profile.selfie_verification_path) return 'not_started';
  if (profile.verification_status === 'verified') return 'verified';
  if (profile.verification_status === 'rejected') return 'rejected';
  if (profile.verification_status === 'pending') return 'pending';
  throw new Error('Status de verificação inválido.');
}

export function getVerificationRequirements(profile: Pick<VerificationProfile, 'cpf' | 'rg' | 'phone'>) {
  return [
    { label: 'CPF informado', complete: Boolean(profile.cpf.trim()) },
    { label: 'RG informado', complete: Boolean(profile.rg.trim()) },
    { label: 'Telefone informado', complete: Boolean(profile.phone.trim()) },
  ];
}
