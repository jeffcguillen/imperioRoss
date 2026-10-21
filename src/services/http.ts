const API_URL = import.meta.env.VITE_API_URL ?? '';

function versionedPath(path: string) {
  return path.startsWith('/api/') && !path.startsWith('/api/v1/')
    ? path.replace(/^\/api\//, '/api/v1/')
    : path;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const businessMessages: Record<string, string> = {
  SORTEO_CERRADO: 'Este sorteo ya cerró.',
  FAVORITE_EXISTS: 'Ese número ya está en tus favoritos.',
  PROFILE_CONTACT_IN_USE: 'Ese teléfono o correo ya está asociado a otra cuenta.',
  CURRENT_PASSWORD_INVALID: 'La contraseña actual no es correcta.',
  PASSWORD_UNCHANGED: 'Elige una contraseña distinta a la actual.',
  CUPO_EXCEDIDO: 'No hay cupo suficiente para esta jugada.',
  SALDO_INSUFICIENTE: 'No tienes saldo suficiente.',
  DEBE_SER_MAYOR_DE_EDAD: 'Debes confirmar que eres mayor de 18 años.',
  METODO_NO_DISPONIBLE: 'Este método de pago no está disponible.',
  DRAW_MODALITY_LOCKED: 'No puedes cambiar estas modalidades porque el sorteo ya tiene jugadas registradas.',
  GUEST_PURCHASE_NOT_FOUND: 'No encontramos una compra con esos datos. Revisa el código y el teléfono.',
  OTP_INVALID: 'El código venció o no es válido. Solicita uno nuevo e inténtalo otra vez.',
  OTP_PROVIDER_UNAVAILABLE: 'La recuperación por SMS no está configurada en este entorno. Inténtalo desde el desarrollo local.',
  LOCATION_HAS_ACTIVE_STAFF: 'Reasigna o desactiva primero el personal activo asignado a este local.',
  SIN_PERMISO: 'Tu cuenta no tiene permiso para realizar esta acción.',
};

function safeMessage(status: number, code?: string) {
  if (code && businessMessages[code]) return businessMessages[code];
  if (status === 401) return 'Revisa tus datos o inicia sesión nuevamente.';
  if (status === 403) return 'Tu cuenta no tiene permiso para realizar esta acción.';
  if (status === 404) return 'No encontramos la información solicitada.';
  if (status === 409) return 'La operación ya fue procesada o cambió. Actualiza e intenta otra vez.';
  if (status === 413) return 'El archivo excede el tamaño permitido.';
  if (status === 429) return 'Has realizado demasiados intentos. Espera un momento y vuelve a probar.';
  if (status >= 500 || status === 0) return 'No pudimos conectar con el servicio. Intenta nuevamente más tarde.';
  return 'Revisa la información ingresada e intenta nuevamente.';
}

async function requestJson<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${versionedPath(path)}`, {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, safeMessage(0));
  }
  if (!response.ok) {
    let code: string | undefined;
    try { code = (await response.json() as { code?: string }).code; } catch { /* respuesta vacía */ }
    throw new ApiError(response.status, safeMessage(response.status, code));
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return requestJson<T>(path, 'GET', undefined, signal);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'POST', body);
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, 'PATCH', body);
}

export async function deleteJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, 'DELETE');
}

export async function postFormData<T>(path: string, body: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${versionedPath(path)}`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }, body });
  } catch {
    throw new ApiError(0, safeMessage(0));
  }
  if (!response.ok) {
    let code: string | undefined;
    try { code = (await response.json() as { code?: string }).code; } catch { /* respuesta vacía */ }
    throw new ApiError(response.status, safeMessage(response.status, code));
  }
  return response.json() as Promise<T>;
}
