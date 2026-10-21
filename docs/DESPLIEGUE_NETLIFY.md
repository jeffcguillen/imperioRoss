# Despliegue de El Imperio de Ross

## Arquitectura preparada

- Frontend React/Vite en Netlify (`netlify.toml`).
- API Fastify en Render (`render.yaml`). Se mantiene como servicio Node persistente porque procesa comprobantes en disco y puede ejecutar jugadas programadas.
- PostgreSQL administrado por separado. La API exige tres logins de mínimo privilegio, además de los roles de grupo que crea el SQL base.
- Los comprobantes se conservan en el disco persistente privado del servicio API.

El proxy `/api/*` de Netlify permite que el navegador use el mismo origen para el frontend y el API. Esto conserva la cookie de sesión `SameSite=Strict` y evita habilitar cookies entre sitios.

## Antes de cargar la base de producción

1. Crea una base PostgreSQL vacía en un proveedor administrado con PostgreSQL 15 o superior.
2. Guarda un respaldo verificable de la base local por separado. El SQL base no migra una base existente.
3. Instala `imperio_de_ross_completo.sql` solamente en la base vacía. El archivo contiene datos DEMO, bancos ficticios y hashes marcadores `REEMPLAZAR_HASH_REAL`; no son cuentas utilizables ni datos de producción. Reemplaza esos datos antes de abrir el sitio al público y registra cuentas administrativas nuevas con contraseñas únicas.
4. Crea tres logins de runtime (`ir_api_staff`, `ir_api_admin`, `ir_migrator`) sin superusuario ni `BYPASSRLS`. Otorga `rf_api_staff` al login staff y `rf_api_admin` al login admin. Concede al migrador `USAGE, CREATE` sobre `app` y los permisos DDL requeridos. El usuario propietario de la base instala el SQL inicial; no conectes la aplicación como propietario, `rf_dev` ni superusuario.
5. Configura conexiones TLS del proveedor para `DATABASE_STAFF_URL`, `DATABASE_ADMIN_URL` y `DATABASE_MIGRATOR_URL`. Mantén las credenciales en el panel de Render.
6. Configura `CLAIM_CODE_KEY` en el backend como secreto aleatorio estable de al menos 32 caracteres (por ejemplo, genera 32 bytes con un administrador de secretos). La clave cifra los códigos privados de premios; no la incluyas en Git, no la copies al frontend y no la rotes mientras existan códigos cifrados, salvo que regeneres los códigos de premios pendientes.
7. Revisa las extensiones `pgcrypto`, `citext` y `pg_trgm` que solicita el SQL y confirma que el proveedor las permite.

La base local `localhost` no es accesible desde Netlify ni Render. No subas un volcado con datos reales a GitHub.

## Publicar el API en Render

1. El código ya está en GitHub, en `jeffcguillen/imperioRoss`, rama `main`.
2. En Render, crea un Blueprint desde ese repositorio y selecciona `render.yaml`.
3. Introduce los tres URLs de conexión de producción y `WEB_ORIGINS` con el dominio de Netlify, por ejemplo `https://imperio-ross.netlify.app`. No incluyas rutas ni barra final.
4. Si cambias el nombre del servicio Render, actualiza también el destino del proxy en `netlify.toml`.
5. Ejecuta las migraciones contra la base nueva desde un entorno controlado usando `DATABASE_MIGRATOR_URL` y `npm run db:migrate`. Haz una copia de seguridad antes de cada migración posterior.
6. Comprueba `https://<api>/health/ready` y que el despliegue no registre `INVALID_STAFF_DATABASE_ROLE` ni `INVALID_ADMIN_DATABASE_ROLE`.

El disco persistente de Render tiene costo y queda adjunto a una instancia/servicio; configura respaldo y retención de comprobantes según las obligaciones del negocio.

## Publicar el frontend en Netlify

1. En Netlify, importa el repositorio GitHub `jeffcguillen/imperioRoss` y selecciona `main` como rama de producción. Netlify detecta `netlify.toml`; el comando es `npm run build` y el directorio publicado es `dist`.
2. Cada push a `main` generará un nuevo deploy de producción. GitHub Actions ejecutará además `npm ci`, `npm run build` y `npm run typecheck:api` para verificar compilación y tipos.
3. No necesitas configurar `VITE_API_URL` en Netlify: si no se define, el frontend usa rutas relativas `/api/v1` que el proxy de `netlify.toml` reenvía al API.
4. Configura el dominio final de Netlify como `WEB_ORIGINS` en Render. Si cambia el dominio o se agregan dominios personalizados, actualiza esa lista.
5. El destino de proxy incluido es `https://imperio-ross-api.onrender.com`; ajústalo si el nombre real de servicio difiere.
6. Publica y verifica login, cierre de sesión, consulta de sorteos, comprobantes y `health/ready` desde el sitio público.

## Jugadas programadas

La configuración inicial las deja deshabilitadas. Después de comprobar el entorno, define `SCHEDULED_PLAYS_TENANT_IDS` con el UUID autorizado del tenant y cambia `SCHEDULED_PLAYS_ENABLED=true` en Render. El proceso del API ejecuta el scheduler y la base serializa los trabajos concurrentes. No uses el tenant local de producción sin verificar que corresponde a la base recién instalada.

## Secretos y datos

- Nunca versionar `.env`, archivos `.local`, respaldos SQL con datos reales, claves ni credenciales de proveedores.
- El navegador solo debe recibir `VITE_API_URL`; URLs de DB, contraseñas y claves de almacenamiento son secretos exclusivos del backend.
- Rotar cualquier clave que haya sido compartida fuera de los paneles de los proveedores.
- Las funciones de correo/SMS y pasarelas de pago requieren credenciales reales y configuración adicional antes de operar transacciones reales.
