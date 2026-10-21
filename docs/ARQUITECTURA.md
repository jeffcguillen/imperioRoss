# Arquitectura actual

## Componentes

- `src/`: aplicación web/PWA en React, TypeScript estricto, Vite, React Router y TanStack Query. Los módulos viven en `src/features/`; las llamadas HTTP pasan por `src/services/http.ts` y usan `/api/v1`.
- `src/tenants/`: resuelve configuración pública y tema por host desde la API. No conecta directamente a PostgreSQL.
- `server/`: API REST Fastify con módulos por dominio en `server/routes/`. Fastify se conserva como servidor existente; no se migró a NestJS. Los endpoints `/api/v1/*` usan las mismas reglas de negocio y autorización que los alias compatibles `/api/*`.
- `server/index.ts`: valida origen, resuelve tenant desde el host, abre una transacción por solicitud, configura `app.tenant_id` y `app.user_id` localmente y libera la conexión al terminar. `/api/v1/admin/*` se enruta por el pool administrativo restringido.
- `server/db/pools.ts`: pools distintos para personal, administración y migraciones. La aplicación no usa `rf_dev`.
- `imperio_de_ross_completo.sql`: referencia de instalación inicial con esquema `app`, tablas, funciones, vistas y RLS. La BD local ya existente se actualiza únicamente con migraciones incrementales.
- `database/migrations/`: migraciones rastreadas por checksum; `database/scripts/migrate.ts` requiere `DATABASE_MIGRATOR_URL`.

## Datos y autorización

PostgreSQL es la fuente de verdad. Las cuentas de runtime son LOGIN de mínimo privilegio, no son superusuario ni tienen `BYPASSRLS`. Las consultas protegidas se hacen dentro de la transacción de solicitud. El tenant y actor salen del host validado y de la sesión; el cliente no puede elegirlos.

El menú filtra por rol, permiso y módulo, pero cada endpoint vuelve a validar sesión, permiso, propiedad del registro y tenant. Las transiciones de compra, saldo, tickets, premios, Contratas, caja y rifas se delegan a funciones/constraints transaccionales existentes cuando corresponde. Las credenciales locales viven solo en `.env` y `.local/`.

La referencia detallada está en [BASE_DATOS_Y_RLS.md](./BASE_DATOS_Y_RLS.md), [ROLES_Y_PERMISOS.md](./ROLES_Y_PERMISOS.md) y [SEGURIDAD.md](./SEGURIDAD.md). El inventario de rutas documentado está en [API.md](./API.md).

## Estado y brechas

La aplicación web, la API Fastify y PostgreSQL local funcionan. Las rutas v1 se validaron en vivo con sesiones DEMO. Los módulos centrales incluyen autenticación, POS, comisiones por venta, Contratas, tickets, premios, rifas, finanzas/caja y administración.

NestJS no se usa; la API mantiene `/api` por compatibilidad además de `/api/v1`. El inventario OpenAPI 3.1 está disponible en desarrollo en `/api/v1/openapi.json` y se genera desde `docs/API.md`; la UI Swagger y los esquemas DTO detallados siguen pendientes. También faltan pruebas RLS multitenant contra una BD aislada, pasarela real, SMS/email/push y los proyectos compilados de Capacitor. No se afirma compatibilidad móvil nativa hasta generar y probar esos artefactos.
