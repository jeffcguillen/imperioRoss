export type Digits = 2 | 3 | 4;

export function isValidPlayedNumber(value: string, digits: Digits) {
  return new RegExp(`^\\d{${digits}}$`).test(value);
}

export function normalizePlayedInput(value: string, digits: Digits) {
  return value.replace(/\D/g, '').slice(0, digits);
}
