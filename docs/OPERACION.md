# Operación local

## PostgreSQL configurado

Se verificó PostgreSQL 18.6 en `localhost:5432`, base `imperio_de_ross`, esquema `app`, tenant activo `imperio-de-ross` (`a0000000-0000-0000-0000-000000000001`) y 61 tablas. El archivo SQL base existe en `C:\Imperio_Ross\imperio_de_ross_completo.sql`; no existe bajo `database/`. El archivo original no se modificó ni se ejecutó.

Se creó la migración incremental `app.schema_migrations` y se registró `0001_schema_migrations.sql`. No se modificaron tablas de negocio.

## Cuentas de aplicación

`rf_dev` es superusuario en la base tras la configuración local. Se usa para el bootstrap, no para runtime. La API utiliza `ir_api_staff` (miembro solo de `rf_api_staff`), `ir_api_admin` (miembro solo de `rf_api_admin`) y `ir_migrator` (DDL limitado al esquema `app`). Los dos logins de API no son superusuarios ni tienen `BYPASSRLS`; staff no puede seleccionar `app.ticket_claim_codes`.

Las claves generadas están en `.env`, ignorado por Git. No se imprimen en logs. El script `npm run db:bootstrap:local` solo acepta `localhost/imperio_de_ross`, aborta si `.env` ya existe y no ejecuta el SQL base.

## Estado de ejecución

La API inició con sus chequeos de roles y pools. `/health/ready` devolvió `ready`. Endpoints GET confirmados: configuración tenant, sorteos abiertos, resultados, opciones de pago; sin cookie, tickets devuelve 401. El API de desarrollo permanece en `127.0.0.1:3000` durante esta sesión.

## Operación general

- No subas `.env`, `.local/`, `var/`, comprobantes ni archivos de base.
- Antes de respaldar una base real, valida cifrado, control de acceso, retención y simulacro de restauración.
- La API emite logs estructurados sin cuerpo de solicitudes ni errores SQL detallados; los errores enviados al cliente incluyen un identificador de solicitud.
- Usa `/health/live` para liveness y `/health/ready` para verificar los dos pools.
