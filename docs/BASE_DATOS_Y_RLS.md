# Base de datos y aislamiento RLS

## Fuente de esquema

El SQL base es [`imperio_de_ross_completo.sql`](../imperio_de_ross_completo.sql), en la raíz del proyecto. Contiene el esquema `app`, las relaciones, restricciones, índices, funciones transaccionales, vistas `security_invoker`, políticas RLS y roles de grupo. Es un archivo de instalación inicial: no se debe reejecutar sobre la base local existente.

La instalación local revisada es PostgreSQL en `localhost:5432`, base `imperio_de_ross`, tenant `a0000000-0000-0000-0000-000000000001`. La clave está en el `.env` ignorado y nunca debe copiarse a documentos, código cliente o logs. La base contiene, entre otros, `users`, `role_permissions`, `orders`, `wallet_ledger`, `tickets`, `commissions`, `commission_plans`, `contratas`, `contrata_slots`, `special_raffles`, `cash_closings` y vistas de consulta con `security_invoker`.

## Contexto de tenant

Cada petición de API obtiene el tenant del host validado, abre una transacción y configura el contexto con parámetros enlazados antes de consultar datos protegidos:

```sql
BEGIN;
SELECT set_config('app.tenant_id', $1, true);
SELECT set_config('app.user_id', $2, true);
-- consultas parametrizadas para el tenant/actor ya autorizados
COMMIT;
```

El tercer argumento de `set_config` hace que el valor viva solo en la transacción actual. No establecerlo al iniciar el proceso ni compartir contexto entre solicitudes. Los jobs y seeds deben abrir una transacción y validar explícitamente tenant/actor igual que la API.

## Roles de base

- `rf_api_staff` y `rf_api_admin` son roles de grupo `NOLOGIN` con permisos distintos.
- `ir_api_staff` e `ir_api_admin` son logins runtime separados; ninguno es superusuario ni `BYPASSRLS`.
- `ir_migrator` se reserva para cambios DDL incrementales.
- `rf_dev` es una cuenta privilegiada local indicada para administración; la API no la usa y las pruebas de acceso se hacen a través de los logins runtime.

No conceder `BYPASSRLS`, deshabilitar políticas ni confiar en filtros de UI. RLS no reemplaza la comprobación de propietario (`user_id`, `seller_id`, local) en el endpoint.

## Cambios y migraciones

Las migraciones en `database/migrations/` deben ser aditivas, revisables e idempotentes cuando sea posible. `database/scripts/migrate.ts` toma un advisory lock, comprueba checksums y usa solo `DATABASE_MIGRATOR_URL`. No usar `DROP SCHEMA`, `CASCADE` ni reinstalar el SQL base en una base con datos.

En Windows, configura `.env` usando [README.md](../README.md), luego usa:

```cmd
npm run db:migrate
```

Los seeds de negocio deben aceptar solo `NODE_ENV=development` y un host/base local, identificar registros como DEMO, mantener FK/estados coherentes y ser repetibles. El [seed de vendedor](../database/scripts/seed-demo-seller.mjs) crea una venta de 25 centavos, su comisión y cupos reservados sin venderlos ni modificar saldos. El [seed de rifas](../database/scripts/seed-demo-raffle.mjs) crea una rifa abierta, paquete, Números Fortuna, cuentas contables DEMO y una notificación; no crea compras ni pagos. El [seed de retiro](../database/scripts/seed-demo-withdrawal.mjs) usa `fn_request_withdrawal` para dejar pendiente el retiro de un premio DEMO, sin confirmar transferencia/pago.

## Comprobación pendiente

La configuración RLS se usa en las rutas actuales y se comprobaron permisos por rol en PostgreSQL local. Todavía falta una prueba automatizada con dos tenants en una base desechable que intente leer y modificar filas ajenas, junto con pruebas de concurrencia para compras, cupos y pagos. No hacer esas pruebas financieras en datos reales locales.
