# Progreso de implementación

Última revisión: 20 de octubre de 2026. La auditoría requisito por requisito está en [`AUDITORIA_PROMPT_MAESTRO.md`](./AUDITORIA_PROMPT_MAESTRO.md); este resumen no sustituye sus criterios ni declara terminado el sistema.

## Bloque concluido en código

- Cuenta: editar nombre, teléfono y correo con normalización, validación de duplicados y auditoría; cambiar contraseña verificando la actual, rotar sesión y revocar sesiones previas.
- Cerrar sesión: la API revoca la sesión activa y elimina la cookie; el cliente limpia datos cacheados y navega a `/acceso` con `replace`. Prueba específica añadida para revocación, cookie y respuesta `204`.
- Tenant: página administrativa para marca, slogan, zona horaria, idioma, moneda, colores, variantes de logo y flag de rifas. La API fija el tenant resuelto por servidor, exige admin + `tenant.manage`, revisión optimista y motivo auditado. Migración 0005 aplicada y verificada en PostgreSQL: admin `true`; client/seller/worker `false`.
- Búsqueda global administrativa: encuentra usuarios, compras y tickets por nombre/teléfono/código, con alcance tenant, escape de comodines, mínimo de dos caracteres y autorización `report.view`; tickets enlazan a su verificador y usuarios a la lista filtrada.
- Gestión de sucursales/locales: crear y editar nombre, ciudad y dirección desde Usuarios y permisos; cada cambio exige motivo y guarda auditoría antes/después dentro de tenant. Conflictos de nombre usan savepoint y responden 409 sin abortar la transacción.
- Datos operativos DEMO: seed idempotente restringido a desarrollo local y a `localhost/imperio_de_ross`. Crea un sorteo “DEMO LOCAL · NO OFICIAL”, dos sesiones, plan, compra de 25 centavos desde la billetera del cliente demo, un ticket y un premio usando `fn_submit_order` y `fn_register_result`. No modifica sorteos oficiales ni usuarios reales. Ejecutar con `npm run db:seed:demo-operations`.
- Código privado de cobro de premios: la migración `0006_prize_claim_security.sql` ya se aplicó en PostgreSQL local. La clave estable `CLAIM_CODE_KEY` se exige desde el backend y se provisionó en el `.env` ignorado; el comprador autenticado y el invitado verificado pueden consultar su código, mientras que caja solo lo ingresa para validar y Administración puede usar la consulta de respaldo autorizada. La función SQL valida código, permisos, expiración y local dentro de la misma transacción, limita intentos a cinco y bloquea por 15 minutos. La recuperación de invitado devuelve el código solo después de OTP, con `Cache-Control: private, no-store`.
- Compras DEMO vigentes: el seed idempotente crea una compra para una sesión futura del sorteo rotulado `DEMO LOCAL · NO OFICIAL`; ahora propaga `CLAIM_CODE_KEY` al contexto SQL para guardar el código cifrado. Tras detectar que las credenciales locales se habían perdido, `db:reset:demo-users` restableció solo las cuatro cuentas `is_demo=true`, revocó sus sesiones y guardó claves aleatorias en `.local/demo-usuarios.txt` (ignorado por Git).

## Verificación más reciente

- `tsc --noEmit -p tsconfig.server.json`: aprobado.
- `tsc -b`: aprobado.
- `vite build`: aprobado.
- Vitest: corrida completa posterior a locales aprobada: 78 pruebas/17 archivos.
- Build final posterior a locales y lazy loading aprobado sin aviso de chunk: `index-*.js` 467.12 kB; Usuarios y Búsqueda global se cargan en chunks administrativos bajo demanda.
- Servidores locales: Vite en `http://127.0.0.1:5173/` devuelve HTTP 200 y HTML de El Imperio de Ross; la API `http://127.0.0.1:3000/health/ready` devuelve `ready`. La falla del navegador se debía al proceso Vite detenido/colgado en 5173; CORS para ese origen funciona. La pestaña 5173 se envió a Codex para abrirse. No se pudo hacer captura/inspección visual automatizada porque CUA está deshabilitado en esta configuración.
- Recorrido HTTP con cliente DEMO: login correcto; `/api/auth/me` identifica el rol client; `/api/sessions/open` devuelve 22 sesiones abiertas, incluido el sorteo demo; `/api/tickets` devuelve 1 ticket; `/api/prizes/mine` devuelve 1 premio. Logout devuelve 204, revoca la sesión y `/api/auth/me` devuelve 401 con la cookie anterior.
- Build y regresión tras este bloque: `tsc --noEmit -p tsconfig.server.json`, `tsc -b`, `vite build` y Vitest (78 pruebas/17 archivos) aprobados. El bundle principal se mantiene en 467.12 kB.
- PostgreSQL: `ir_migrator` carecía de permiso sobre `app.role_permissions`; se aplicó 0005 usando el acceso local rf_dev autorizado por el usuario. Verificadas las cuatro filas de rol. En esta revisión se insertó el fixture operativo DEMO descrito arriba; no se tocaron movimientos de cuentas ni sorteos oficiales.
- Fase de cobro de premios: PostgreSQL local aplicó migraciones 0006-0008 mediante `rf_dev`. Las pruebas transaccionales sobre DEMO confirmaron tanto rechazo de código inválido como el pago con código válido; ambos escenarios terminaron con `ROLLBACK`, sin dejar asientos ni cambiar estados. También se verificó la recuperación del mismo código cifrado por comprador y administrador autorizado, con sus cambios de prueba revertidos. Vitest: 128 pruebas en 24 archivos aprobadas; `tsc -b`, `vite build` y `tsc --noEmit -p tsconfig.server.json` pasan.
- El seed reactivó un premio DEMO futuro en el sorteo marcado NO OFICIAL. API local verificada: login correcto de `admin`, `worker`, `seller` y `client`; cada cuenta devolvió su rol esperado, logout respondió 204 y la cookie revocada obtuvo 401. Cliente DEMO consultó el premio/código privado con 200 y encabezado `private, no-store`. No se mostraron las claves ni el código.
- Clave de producción pendiente: configurar `CLAIM_CODE_KEY` como secreto estable de al menos 32 caracteres en el proveedor del backend antes de desplegar. No publicar la clave local ni rotarla sin un proceso de regeneración para códigos ya cifrados.

## Siguiente orden

1. Completar ciclo de locales y CRUD de sorteos/modalidades/planes/cierres.
2. Completar recuperación de compras de invitado y administración integral de anulación/reembolso de tickets.
3. Completar panel vendedor y liquidación, preferencias de notificaciones y verificaciones de cada flujo en DB desechable.
4. Configurar proveedores externos (pasarela, correo/SMS, push) y toolchain Capacitor cuando estén disponibles; cerrar con E2E y auditoría responsive/accesibilidad.
