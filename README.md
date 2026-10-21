# El Imperio de Ross

Plataforma multitenant de sorteos y rifas. El modelo de datos de referencia está en `imperio_de_ross_completo.sql`, ubicado en la raíz. Ese SQL instala el esquema y agrega registros DEMO con hashes de contraseña marcadores; **no lo ejecutes sobre la base local ya configurada ni publiques sus datos DEMO en producción sin revisarlos**. Las migraciones posteriores se aplican por separado.

## Requisitos

- Node.js 20+ y npm.
- PostgreSQL 15+.
- En el entorno local actual: PostgreSQL 18.6, base `imperio_de_ross`, esquema `app`, tenant `imperio-de-ross`.

## Estado de la base local

La base existente ya contiene 61 tablas y el tenant configurado. Se aplicó únicamente la migración aditiva `0001_schema_migrations.sql`. El archivo SQL original no se ejecutó ni modificó.

El usuario `rf_dev` es superusuario local y se reserva para el bootstrap. La API usa los logins de mínimo privilegio `ir_api_staff` y `ir_api_admin`; las claves aleatorias están guardadas en `.env`, que no se versiona. El migrador `ir_migrator` solo tiene DDL en el esquema `app`.

## Iniciar en Windows

Abre dos ventanas CMD desde `C:\Imperio_Ross`. Para activar Node instalado en esta máquina, antepone en cada ventana:

```cmd
set "PATH=C:\Users\Admin\AppData\Local\Author Software\nvm\installs\v22.23.3;%PATH%"
```

Ventana 1, API:

```cmd
npm run dev:api
```

Ventana 2, frontend:

```cmd
npm run dev -- --host 127.0.0.1
```

Abre `http://127.0.0.1:5173`. La API escucha en `http://127.0.0.1:3000`.

La PWA está disponible en el build de producción. La configuración y los pasos para preparar los proyectos Android/iOS con Capacitor están en [docs/MIGRACION_MOVIL.md](docs/MIGRACION_MOVIL.md); la compilación nativa requiere instalar dependencias de Capacitor desde npm y las herramientas de plataforma correspondientes.

La API que usa el frontend está versionada bajo `/api/v1`; el servidor mantiene `/api` como alias compatible. El catálogo de rutas y permisos está en [docs/API.md](docs/API.md), y en desarrollo puedes abrir el inventario OpenAPI en `http://127.0.0.1:3000/api/v1/openapi.json`. Actualízalo con `npm run docs:openapi` al cambiar el catálogo. La UI Swagger y los esquemas DTO detallados aún faltan.

## Preparar otra instalación local

`npm run db:bootstrap:local` sirve únicamente para `localhost/imperio_de_ross`. Antes de ejecutarlo, guarda la cadena de conexión de una cuenta local con privilegios de bootstrap en `.local/dbadmin.env` con el formato `DATABASE_URL=postgresql://USUARIO:CLAVE@localhost:5432/imperio_de_ross`. El script crea los tres logins de mínimo privilegio y escribe sus claves aleatorias en `.env`; aborta si `.env` ya existe. No imprimas ni compartas estos archivos.

Después ejecuta:

```cmd
npm run db:migrate
```

Para una base nueva y vacía, instala primero el SQL base una sola vez con `psql -v ON_ERROR_STOP=1 -d NOMBRE_BASE -f imperio_de_ross_completo.sql`; luego configura roles y migraciones para ese entorno. Nunca lo ejecutes sobre una base con datos existentes.

## Comprobaciones

```cmd
npm test
npm run build
npm run typecheck:api
```

Correo/SMS, almacenamiento externo y pasarelas requieren credenciales reales. Consulta `docs/INTEGRACIONES.md` y `PROGRESO.md`; la aplicación no simula confirmaciones de esos servicios.

Para publicar el frontend, API y PostgreSQL con configuración de producción, sigue la guía [docs/DESPLIEGUE_NETLIFY.md](docs/DESPLIEGUE_NETLIFY.md). El frontend se publica en Netlify; la API persistente y sus comprobantes se alojan en Render, y PostgreSQL en un servicio administrado. No publiques `.env` ni subas datos reales a GitHub.

Las cuentas y contraseñas aleatorias del entorno DEMO local están en `.local/demo-usuarios.txt` (archivo ignorado por Git). No compartas ese archivo. Los datos de ejemplo se agregan mediante seeds restringidos a desarrollo/local; para volver a crear actividad de ventas, comisiones y Contratas del vendedor, ejecuta en PowerShell:

```powershell
$env:NODE_ENV='development'
node --env-file=.env database/scripts/seed-demo-seller.mjs
node --env-file=.env database/scripts/seed-demo-raffle.mjs
node --env-file=.env database/scripts/seed-demo-withdrawal.mjs
```

Los seeds son idempotentes. El de vendedor no vende cupos ni altera saldos; el de rifas no crea compras ni pagos; el de retiro solo deja una solicitud sobre un premio DEMO en estado pendiente y nunca lo marca como pagado.
