const businessCodes: Record<string, { status: number; message: string }> = {
  SORTEO_CERRADO: { status: 409, message: 'Este sorteo ya cerró.' },
  CUPO_EXCEDIDO: { status: 409, message: 'No hay cupo suficiente para esta jugada.' },
  VALOR_INVALIDO: { status: 400, message: 'El valor indicado no es válido.' },
  PLAN_REQUERIDO: { status: 409, message: 'Selecciona un plan disponible.' },
  SIN_PLAN_ACTIVO: { status: 409, message: 'No hay un plan activo para esta modalidad.' },
  SALDO_INSUFICIENTE: { status: 409, message: 'No tienes saldo suficiente.' },
  SALDO_REQUIERE_SESION: { status: 401, message: 'Inicia sesión para pagar con tu saldo.' },
  DEBE_SER_MAYOR_DE_EDAD: { status: 400, message: 'Debes confirmar que eres mayor de 18 años.' },
  METODO_NO_DISPONIBLE: { status: 409, message: 'Este método de pago no está disponible.' },
  SIN_PERMISO: { status: 403, message: 'Tu cuenta no tiene permiso para realizar esta acción.' },
  SOLO_ADMIN: { status: 403, message: 'Esta acción requiere autorización de Administración.' },
  MOTIVO_REQUERIDO: { status: 400, message: 'Escribe el motivo de esta operación.' },
  CARRITO_VACIO: { status: 400, message: 'Agrega al menos una jugada.' },
  PLAN_INVALIDO: { status: 409, message: 'El plan seleccionado ya no está disponible.' },
  PAGO_NO_EDITABLE: { status: 409, message: 'Este pago ya no admite comprobantes.' },
  SESION_INVALIDA: { status: 400, message: 'La sesión de sorteo ya no está disponible.' },
  MONTO_FUERA_DE_RANGO_METODO: { status: 400, message: 'El monto no cumple las condiciones del método de pago.' },
  CUENTA_NO_ACTIVA: { status: 403, message: 'La cuenta está inactiva.' },
  INVITADO_DEBE_CREAR_CUENTA: { status: 401, message: 'Crea una cuenta para continuar.' },
  TRANSICION_INVALIDA: { status: 409, message: 'El estado cambió. Actualiza la página e inténtalo otra vez.' },
  ORDEN_NO_PENDIENTE: { status: 409, message: 'Esta compra ya no está pendiente de revisión.' },
};

export function publicError(error: unknown) {
  const raw = error instanceof Error ? error.message : '';
  const sqlState = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const code = raw.match(/^([A-ZÁÉÍÓÚÑ_]+)/)?.[1];
  if (code && businessCodes[code]) return { status: businessCodes[code].status, code, message: businessCodes[code].message };
  if (sqlState === '23505') return { status: 409, code: 'DUPLICATE', message: 'Ya existe una cuenta con esos datos.' };
  if (sqlState === '23503' || sqlState === '23514') return { status: 400, code: 'INVALID_DATA', message: 'Revisa la información ingresada.' };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'No pudimos completar la solicitud. Intenta nuevamente.' };
}
