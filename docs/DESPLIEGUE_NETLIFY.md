# Despliegue de El Imperio de Ross

## Arquitectura

- Frontend React/Vite en Netlify (`netlify.toml`).
- API Fastify persistente en Render (`render.yaml`).
- PostgreSQL administrado en Supabase. Netlify y GitHub no alojan ni ejecutan la base de datos.
- Comprobantes en el disco persistente privado del servicio API en Render.

Netlify reenvía `/api/*` al servicio Render y conserva la sesión del mismo origen. El frontend, la API y PostgreSQL deben estar desplegados y conectados para que el login funcione.

## Crear y preparar Supabase

1. Crea un proyecto PostgreSQL en Supabase y conserva el `Project reference` y la contraseña de base de datos.
2. El repositorio ya contiene `supabase/migrations/` con el esquema base y las ocho migraciones de la aplicación. En la integración de GitHub de Supabase conecta `jeffcguillen/imperioRoss`, usa directorio de trabajo `.`, rama de producción `main` y activa **Deploy to production**. La integración aplicará las migraciones que encuentre en esa carpeta al proyecto de producción.
3. Ejecuta este primer despliegue solo si la base del proyecto Supabase está vacía y aún no contiene el esquema `app`. Si ya instalaste el esquema manualmente, no actives una segunda instalación; la migración inicial fallará al detectar objetos existentes.
4. En el botón **Connect** del proyecto, copia la cadena **Session pooler**. Render ejecuta un backend Node persistente sobre IPv4; usa el pooler de sesión en puerto `5432`. No uses Transaction pooler `6543`: pierde estado de sesión y no es compatible con algunas operaciones de esta API. Mantén `sslmode=require` en la URL.
5. Copia `database/supabase.env.example` a `.local/supabase.env` y completa `SUPABASE_PROJECT_REF` y `SUPABASE_DB_URL`. `.local/` está excluido de Git.
6. Espera a que la integración de Supabase indique que aplicó correctamente las nueve migraciones. Después ejecuta:

   ```cmd
   npm run db:bootstrap:supabase
   ```

   El bootstrap verifica el historial de Supabase, alinea `app.schema_migrations`, genera roles de API con contraseñas aleatorias y reemplaza los hashes marcadores de las cuatro cuentas DEMO. No sobrescribe roles ni contraseñas que ya existan.

5. Conserva de forma privada los archivos generados:
   - `.local/supabase-runtime.env`: `DATABASE_STAFF_URL`, `DATABASE_ADMIN_URL` y `CLAIM_CODE_KEY` para los secretos de Render.
   - `.local/supabase-demo-users.txt`: teléfonos y contraseñas DEMO para el primer ingreso y la verificación.

El usuario propietario de Supabase queda únicamente en `.local/supabase.env`, usado desde tu equipo para el bootstrap. **No lo configures en Render.** La base inicial contiene datos demostrativos y cuentas DEMO; no copia automáticamente los registros de tu PostgreSQL local. Revisa y sustituye los datos de demostración antes de recibir operaciones reales.

## Desplegar el API en Render

1. En Render crea un Blueprint desde `jeffcguillen/imperioRoss`, rama `main`, y selecciona `render.yaml`.
2. Configura `WEB_ORIGINS` con el dominio exacto de Netlify, sin ruta ni barra final. Por ejemplo: `https://imperioross.netlify.app`.
3. Desde `.local/supabase-runtime.env`, copia `DATABASE_STAFF_URL`, `DATABASE_ADMIN_URL` y `CLAIM_CODE_KEY` a las variables secretas correspondientes del servicio. No agregues la cadena del propietario de Supabase.
4. El API valida los roles en su inicio. En los logs no debe aparecer `INVALID_STAFF_DATABASE_ROLE` ni `INVALID_ADMIN_DATABASE_ROLE`. Comprueba `https://imperio-ross-api.onrender.com/health/ready`; debe responder `{"status":"ready"}`.
5. Si el nombre o dominio del servicio API en Render cambia, actualiza el proxy en `netlify.toml` y vuelve a publicar el frontend.

El servicio API usa un disco persistente para comprobantes y puede tener costo. Configura respaldos y retención según las necesidades del negocio.

## Desplegar el frontend en Netlify

1. Importa `jeffcguillen/imperioRoss`, rama `main`. Netlify lee `netlify.toml`, ejecuta `npm run build` y publica `dist`.
2. No configures `VITE_API_URL` en Netlify: el frontend usa `/api/v1` y Netlify lo reenvía al API.
3. Después del deploy, verifica login, cierre de sesión, sorteos, tickets y comprobantes. El login DEMO inicial se consulta en `.local/supabase-demo-users.txt`.

## Secretos, datos y migraciones futuras

- No subas `.env`, `.local/`, volcados con datos reales, contraseñas ni credenciales de proveedores a GitHub.
- Para instalaciones sin la integración de GitHub, `npm run db:install:supabase` y `npm run db:migrate:supabase` son una alternativa manual. Solo se usan en una base vacía y no importan el contenido de tu base local.
- No ejecutes a la vez la instalación manual y la migración de GitHub sobre la misma base.
- No habilites operaciones reales de pagos, correo o SMS hasta configurar y verificar sus credenciales de proveedor.
