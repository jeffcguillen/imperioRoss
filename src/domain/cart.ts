export interface DraftCartLine {
  id: string;
  drawId: string;
  sessionId: string;
  drawName: string;
  drawDate: string;
  digits: 2 | 3 | 4;
  number: string;
  amountCents: string;
  planId?: string;
}

export interface CartDraft {
  idempotencyKey: string;
  items: DraftCartLine[];
}

function getStorageKey() { return `ross:cart:${window.location.host}`; }

function newKey() {
  return globalThis.crypto.randomUUID();
}

function isCartLine(value: unknown): value is DraftCartLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Partial<DraftCartLine>;
  return typeof line.id === 'string' && typeof line.drawId === 'string' && typeof line.sessionId === 'string'
    && typeof line.drawName === 'string' && typeof line.drawDate === 'string'
    && [2, 3, 4].includes(line.digits ?? 0) && typeof line.number === 'string'
    && /^\d+$/.test(line.number) && line.number.length === line.digits
    && typeof line.amountCents === 'string' && /^\d+$/.test(line.amountCents)
    && (line.planId === undefined || typeof line.planId === 'string');
}

export function loadCartDraft(): CartDraft {
  try {
    const stored = window.localStorage.getItem(getStorageKey());
    if (stored) {
      const value = JSON.parse(stored) as Partial<CartDraft>;
      if (typeof value.idempotencyKey === 'string' && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(isCartLine)) {
        return { idempotencyKey: value.idempotencyKey, items: value.items };
      }
    }
  } catch { /* el borrador inválido se inicia vacío; no es fuente financiera */ }
  return { idempotencyKey: newKey(), items: [] };
}

export function saveCartDraft(draft: CartDraft) {
  try { window.localStorage.setItem(getStorageKey(), JSON.stringify(draft)); } catch { /* puede continuar como carrito temporal en memoria */ }
}

export function newCartKey() { return newKey(); }

export function centsToUsd(cents: string | bigint) {
  const amount = typeof cents === 'bigint' ? cents : BigInt(cents);
  const whole = amount / 100n;
  const fraction = (amount % 100n).toString().padStart(2, '0');
  return `$${new Intl.NumberFormat('en-US').format(Number(whole))}.${fraction}`;
}

export function dollarsToCents(value: string): string | null {
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  try { return (BigInt(match[1]) * 100n + BigInt(fraction || '0')).toString(); } catch { return null; }
}

export function totalCartCents(items: ReadonlyArray<Pick<DraftCartLine, 'amountCents'>>) {
  return items.reduce((total, item) => total + BigInt(item.amountCents), 0n);
}
