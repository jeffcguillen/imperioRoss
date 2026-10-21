# Base de datos

El SQL de referencia está en `C:\Imperio_Ross\imperio_de_ross_completo.sql`. Declara esquema `app`, tablas de tenant/usuarios/sesiones/permisos; sorteos/modalidades/planes/sesiones; pedidos/pagos/tickets/comprobantes; billetera/libro/recargas/retiros; resultados/premios; rifas; vendedores/comisiones/contratas; contabilidad/caja; notificaciones/auditoría. Incluye RLS por tenant, restricciones, índices, triggers de auditoría e inmutabilidad, funciones de negocio y vistas `security_invoker`.

Funciones atómicas verificadas: `fn_submit_order`, `fn_review_order`, `fn_reject_order`, `fn_attach_proof`, `fn_confirm_gateway_payment`, `fn_get_wallet`, `fn_request_recharge`, `fn_review_recharge`, `fn_request_withdrawal`, `fn_advance_withdrawal`, `fn_register_result`, `fn_validate_prize`, `fn_confirm_prize_payment`, `fn_credit_prize_to_wallet`, `fn_submit_raffle_purchase` y `fn_cash_preview`/`fn_close_cash`.

## Roles y RLS

La base define grupos `NOLOGIN` `rf_api_staff` y `rf_api_admin`. El API usa logins diferentes, cada uno miembro solo de su grupo, sin superusuario ni `BYPASSRLS`. El rol staff no puede seleccionar `app.ticket_claim_codes`. Las conexiones transaccionales fijan `app.tenant_id` y `app.user_id` antes de consultar datos del tenant.

`rf_dev` quedó como superusuario local por la configuración indicada por el usuario; el backend nunca lo utiliza. Para bootstrap local se generan `ir_api_staff`, `ir_api_admin` e `ir_migrator`. El migrador cuenta con `USAGE, CREATE` en `app` y las conexiones runtime conservan los permisos de sus grupos.

## Migraciones

La base inicial no contenía `app.schema_migrations`. Se aplicó `database/migrations/0001_schema_migrations.sql`, que crea esa tabla y registra el checksum. `database/scripts/migrate.ts` serializa migraciones con un advisory lock y aborta si cambia el checksum de una migración ya aplicada.

## Verificación local

El 19 de octubre de 2026 se verificó PostgreSQL 18.6, base `imperio_de_ross`, esquema `app`, tenant activo `a0000000-0000-0000-0000-000000000001` y 61 tablas. La ruta `database/imperio_de_ross_completo.sql` no existe; el SQL original está en la raíz y no se ejecutó.

La API inició sus comprobaciones de rol y conexiones. `/health/ready` respondió `ready`; GET de configuración del tenant, sorteos, resultados y métodos de pago funcionaron con RLS. Sin sesión, `/api/tickets` devolvió 401. Los sorteos abiertos consultados fueron 18; no se enviaron compras de prueba ni se modificaron tablas de negocio.

El SQL base incluye datos demo y hashes marcador `$2b$12$REEMPLAZAR_HASH_REAL`; no usar como credenciales. Los seeds demo deben ejecutarse solo en desarrollo.
