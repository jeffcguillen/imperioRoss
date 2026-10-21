# Despliegue de El Imperio de Ross

## Arquitectura

- Frontend React/Vite en Netlify (`netlify.toml`).
- API Fastify persistente en Render (`render.yaml`).
- PostgreSQL administrado en Supabase. Netlify y GitHub no alojan ni ejecutan la base de datos.
- Comprobantes en el disco persistente privado del servicio API en Render.

Netlify reenvía `/api/*` al servicio Render y conserva la sesión del mismo origen. El frontend, la API y PostgreSQL deben estar desplegados y conectados para que el login funcione.

## Crear y preparar Supabase

1. Crea un proyecto PostgreSQL en Supabase y conserva el `Project reference` y la contraseña de base de datos.
2. En el botón **Connect** del proyecto, copia la cadena **Session pooler**. Render ejecuta un backend Node persistente sobre IPv4; usa el pooler de sesión en puerto `5432`. No uses Transaction pooler `6543`: pierde estado de sesión y no es compatible con algunas operaciones de esta API. Mantén `sslmode=require` en la URL.
3. Copia `database/supabase.env.example` a `.local/supabase.env` y completa `SUPABASE_PROJECT_REF` y `SUPABASE_DB_URL`. `.local/` está excluido de Git.
4. Asegúrate de que el proyecto Supabase sea nuevo y que no exista el esquema `app`. Solo entonces configura `SUPABASE_INSTALL_EMPTY_DB=YES` en el archivo local y ejecuta:

   ```cmd
   npm run db:install:supabase
   npm run db:migrate:supabase
   npm run db:bootstrap:supabase
   ```

   El instalador se niega a continuar si ya existe el esquema `app`. Instala `imperio_de_ross_completo.sql`, aplica todas las migraciones como propietario desde tu máquina y genera roles de API con contraseñas aleatorias. El bootstrap también reemplaza los hashes marcadores de las cuatro cuentas DEMO por contraseñas aleatorias. No sobrescribe roles ni contraseñas que ya existan.

5. Conserva de forma privada los archivos generados:
   - `.local/supabase-runtime.env`: `DATABASE_STAFF_URL`, `DATABASE_ADMIN_URL` y `CLAIM_CODE_KEY` para los secretos de Render.
   - `.local/supabase-demo-users.txt`: teléfonos y contraseñas DEMO para el primer ingreso y la verificación.

El usuario propietario de Supabase queda únicamente en `.local/supabase.env`, usado desde tu equipo para instalar y migrar. **No lo configures en Render.** La base inicial contiene datos demostrativos y cuentas DEMO; no copia automáticamente los registros de tu PostgreSQL local. Revisa y sustituye los datos de demostración antes de recibir operaciones reales.

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
- Las migraciones iniciales se ejecutan desde el equipo del propietario usando Supabase Session pooler. El propietario no se almacena en Render.
- `npm run db:install:supabase` es solo para una base vacía y no importa el contenido de tu base local. Nunca lo uses para reemplazar una base que ya tiene datos.
- No habilites operaciones reales de pagos, correo o SMS hasta configurar y verificar sus credenciales de proveedor.
