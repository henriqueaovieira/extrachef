export function formatInput(value: string, mask: 'cpf' | 'cnpj' | 'phone' | 'postal-code') {
  const limit = { cpf: 11, cnpj: 14, phone: 13, 'postal-code': 8 }[mask];
  let digits = value.replace(/\D/g, '').slice(0, limit);
  if (mask === 'cpf') {
    return digits.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
  }
  if (mask === 'cnpj') {
    return digits.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  if (mask === 'postal-code') return digits.replace(/^(\d{5})(\d)/, '$1-$2');
  let prefix = '';
  if (digits.length > 11 && digits.startsWith('55')) {
    prefix = '+55 ';
    digits = digits.slice(2);
  } else digits = digits.slice(0, 11);
  if (!digits) return prefix;
  if (digits.length <= 2) return `${prefix}(${digits}`;
  const subscriber = digits.slice(2);
  const groupLength = subscriber.length > 8 ? 5 : 4;
  return `${prefix}(${digits.slice(0, 2)}) ${subscriber.slice(0, groupLength)}${subscriber.length > groupLength ? `-${subscriber.slice(groupLength)}` : ''}`;
}
