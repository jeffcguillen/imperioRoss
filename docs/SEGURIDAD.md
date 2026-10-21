# Seguridad

- Dos pools de API distintos con logins runtime no superusuario y sin `BYPASSRLS`.
- El pool staff verifica que no pueda leer `ticket_claim_codes`; se aborta el arranque con roles incorrectos.
- Cada solicitud `/api/*` resuelve el tenant desde Host/dominio o `DEFAULT_TENANT_SLUG`, abre transacción y fija contexto RLS en la misma conexión.
- Consultas parametrizadas; validación Zod de inputs; errores 4xx/5xx genéricos en español; no se envía SQL, hashes ni tokens.
- Contraseñas con bcryptjs, factor 12; cinco intentos fallidos bloquean 15 minutos.
- Sesión opaca aleatoria: solo su SHA-256 se persiste en `auth_sessions`; cookie HttpOnly/SameSite Strict y Secure en producción.
- CORS por lista permitida, Helmet, rate limiting y límite de body JSON.
- Servicio worker excluye `/api/`; no cachea saldos ni datos de cuenta.

Pendiente antes de producción: CSRF con revisión de despliegue/orígenes y proxy; segundo factor; auditoría de cambio de contraseña; recuperación con proveedor; pruebas de roles/RLS; control de secretos y rotación; límites avanzados de login/OTP; almacenamiento de comprobantes y análisis de archivos.
