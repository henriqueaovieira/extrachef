export function normalizeDocument(value: string) {
  return value.replace(/\D/g, '');
}

function hasRepeatedDigits(value: string) {
  return /^([0-9])\1+$/.test(value);
}

function calculateDigit(value: string, weights: number[]) {
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(value: string) {
  const cpf = normalizeDocument(value);
  if (cpf.length !== 11 || hasRepeatedDigits(cpf)) return false;

  const firstDigit = calculateDigit(cpf.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calculateDigit(cpf.slice(0, 9) + firstDigit, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);

  return Number(cpf[9]) === firstDigit && Number(cpf[10]) === secondDigit;
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeDocument(value);
  if (cnpj.length !== 14 || hasRepeatedDigits(cnpj)) return false;

  const firstDigit = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calculateDigit(cnpj.slice(0, 12) + firstDigit, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return Number(cnpj[12]) === firstDigit && Number(cnpj[13]) === secondDigit;
}