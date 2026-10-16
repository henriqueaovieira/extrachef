interface ProfileFields {
  city?: string | null;
  phone?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  address?: string | null;
  profile_photo_path?: string | null;
  resume_pdf_path?: string | null;
  logo_path?: string | null;
}

export function getProfileProgress(role: 'worker' | 'restaurant', name: string, fields: ProfileFields) {
  const checks: Array<[string, string | null | undefined]> = [
    ['Nome', name],
    ['Cidade', fields.city],
    ['Telefone', fields.phone],
  ];
  if (role === 'worker') checks.push(['CPF', fields.cpf], ['Currículo', fields.resume_pdf_path], ['Foto', fields.profile_photo_path]);
  else checks.push(['CNPJ', fields.cnpj], ['Endereço', fields.address], ['Logo', fields.logo_path]);
  const items = checks.map(([label, value]) => ({ label, complete: Boolean(value?.trim()) }));
  return {
    items,
    percentage: Math.round(items.filter((item) => item.complete).length / items.length * 100),
  };
}
