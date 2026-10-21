# Progreso de integración — El Imperio de Ross

### Inicio y navegación de módulos por rol — 20 de octubre de 2026

- Se eliminó la franja “N módulos disponibles” para los roles administrativos, trabajador y vendedor. El saldo del cliente se mantiene porque sí es información real y accionable de la billetera.
- El inicio ahora muestra tarjetas funcionales para todas las rutas habilitadas a la cuenta, con descripción y acceso directo. Inicio y menú usan el mismo catálogo filtrado por rol, permiso y módulos del tenant; la opción “Menú” está disponible también en escritorio y permite navegar desde cualquier pantalla. En móvil se conserva la barra de accesos frecuentes y el menú completo desplazable.
- Las tarjetas tienen jerarquía visual, descripciones, estado de foco/teclado y adaptación a escritorio/móvil. Solo se muestran las funciones autorizadas para la cuenta; no se exponen accesos sin permiso.
- Verificación: TypeScript frontend/API, build de producción y 124 pruebas en 23 archivos aprobadas. No se pudo revisar visualmente el navegador porque el uso local sigue deshabilitado en Work.

### Descarga de tickets en PDF — 20 de octubre de 2026

- La acción de descarga ahora produce un PDF real de una página, con diseño de recibo premium, logo, estado, sorteo, emisión, modalidad, números, valores, total y QR por ticket. La imagen se rasteriza a una resolución limitada para evitar archivos innecesariamente pesados.
- El botón se rotula “Descargar PDF” e informa si el navegador no pudo preparar el archivo; se conserva por separado la opción de impresión. La descarga SVG se retiró.
- Verificación: 124 pruebas en 23 archivos aprobadas; TypeScript frontend/API y build de producción aprobados. Una prueba verifica cabecera PDF, recursos de logo/QR y offsets de objetos del índice xref.

### Comprobantes de ticket con marca y QR — 20 de octubre de 2026

- La consulta pública `/verificar/:codigo` genera un QR PNG individual que codifica la URL pública exacta del ticket. Muestra el logo del tenant, incluye el logo del sistema y QR en el PDF descargable/impreso, y permite compartir el enlace de verificación. POS agrega acceso directo a cada comprobante QR; estados visibles traducidos al español.
- Se añadieron fixtures DEMO locales idempotentes usando tablas y funciones ya existentes: venta/orden, artículo, ticket, premio, comisión de vendedor, Contrata con cupos, rifa/paquete/Números Fortuna y retiro pendiente. No se marcó ninguna transferencia como pagada.
- Los seeds informaron relaciones DEMO: 1 venta con 1 comisión y 2 cupos reservados; 1 rifa con paquete y 2 Números Fortuna; 1 retiro pendiente ligado al premio DEMO; y la compra DEMO de operaciones con su ticket/premio. La consulta RLS comprobó conteos agregados del tenant (2 órdenes, 2 artículos, 2 tickets, 1 premio, 1 comisión, 4 rifas, 4 paquetes, 4 Números Fortuna y 1 retiro), sin atribuir filas preexistentes a los seeds y sin devolver PII/importes.
- Verificación: 123 pruebas en 22 archivos, typecheck de API y build de producción aprobados. La prueba nueva confirma que cada URL genera un QR PNG; no se hizo lectura física del QR con cámara ni recorrido visual de navegador en esta ejecución.

### Edición y publicación de comisiones y revisión por roles — 20 de octubre de 2026

- `/admin/comisiones` ahora permite crear reglas; editar/publicar una activa con motivo obligatorio y auditoría; retirar (baja lógica) y reactivar una regla retirada. Se conserva el historial contable y la API rechaza solapamientos al editar o reactivar. La administración requiere ambos permisos (`commission.manage` y `finance.manage`).
- Se cotejaron menús, guards y módulos de los cuatro roles con la guía v5.0. La matriz revisada está en `docs/ROLES_Y_PERMISOS.md`; los estados conocidos que se muestran en etiquetas están traducidos al español. No se hizo una prueba visual por cada rol, por lo que la matriz refleja el código y aún requiere QA integrado.
- Verificación: TypeScript frontend/API, compilación Vite y 122 pruebas en 21 archivos aprobadas. OpenAPI regenerado con la ruta de edición. No se hizo una prueba visual por cada rol ni se modificaron datos de PostgreSQL; la matriz refleja el código y aún requiere QA integrado.
- En la comparación del Word quedan pendientes de implementación/prueba las brechas por fase descritas en `docs/AUDITORIA_PROPUESTA_ROSS_FORTUNA.md`; el sistema aún no está certificado completo.

### Comparación con la propuesta detallada v5.0 — 20 de octubre de 2026

- Se recibió y cotejó `Ross_Fortuna_Propuesta_Detalle_actualizada_Jef.docx` (23 de septiembre de 2026) con la implementación actual. El resultado por fase, los criterios y las brechas verificadas están en `docs/AUDITORIA_PROPUESTA_ROSS_FORTUNA.md`.
- Se implementó la acción “Repetir jugada” desde los tickets del cliente: la API solo devuelve líneas activas de tickets propios; la compra previa se copia al carrito, conserva el plan si sigue vigente y obliga a elegirlo si cambió. No se envía ninguna compra automáticamente.
- Verificación: 119 pruebas en 21 archivos aprobadas; TypeScript frontend/API y build Vite aprobados. No se verificó el recorrido con navegador ni PostgreSQL aislado, por lo que la integración con datos reales sigue pendiente.

### Accesos visibles para usuarios, roles y comisiones — 20 de octubre de 2026

- El panel de administración ahora muestra accesos directos a Usuarios, roles y permisos, y a la asignación de comisiones; ambos también aparecen en los accesos rápidos de inicio según los permisos efectivos.
- En Usuarios se puede asignar `worker`/`seller` al crear personal y cambiar el rol entre esos dos tipos para una cuenta activa con local vigente. Cuentas admin/cliente quedan protegidas; los cambios requieren motivo y auditoría. La matriz permite configurar permisos/alcance por rol y autorizaciones individuales de personal.
- `Comisiones de vendedores` permite crear reglas porcentuales/fijas o de utilidad mensual por alcance de vendedor, sorteo y modalidad, y desactivar planes con motivo; PostgreSQL y la API comprueban `commission.manage` y `finance.manage`.
- Se agregaron pruebas de cambio de rol y de protección de cuentas elevadas. TypeScript API/frontend, 15 pruebas relacionadas con permisos/usuarios/comisiones y build Vite aprobados. El formulario de cambio de rol fue probado en Fastify inject; no se cambió ningún rol real en la base.

### Inicio de sesión obligatorio y espacio por rol — 20 de octubre de 2026

- La guía principal confirma cuatro roles (`admin`, `worker`, `seller`, `client`). Se documentó la matriz de módulos en `docs/ROLES_Y_PERMISOS.md` y se actualizó la auditoría de requisitos.
- Toda ruta interna ahora requiere sesión válida (`/api/auth/me`); una sesión ausente envía a `/acceso`, guarda el destino y vuelve a él tras autenticar. `/verificar/:codigo` permanece como consulta pública limitada del ticket, sin datos personales.
- Se filtraron accesos y rutas directas por rol, permiso y bandera del tenant. El inicio del cliente presenta saldo/compra; el de administración, trabajador y vendedor presenta herramientas operativas que coinciden con permisos cargados desde la BD. Los endpoints de servidor siguen siendo el control efectivo.
- Verificación tras cambios: TypeScript de API y frontend, build de Vite y 78 pruebas en 17 archivos aprobadas. No se pudo validar en navegador/API local en esta ejecución: el sandbox rechazó sockets de `127.0.0.1`, y el control de navegador está deshabilitado. Pendientes globales documentados: editor CRUD completo de sorteos, anulaciones/reembolsos integrales, recuperación segura de compra de invitado, experiencia vendedor ampliada, proveedores externos y E2E PostgreSQL.

### Anulación administrativa de tickets — 20 de octubre de 2026

- La búsqueda global de administración ahora ofrece anular tickets activos con `ticket.void`; exige motivo, consulta y bloquea el ticket dentro del tenant, y ejecuta `app.fn_void_ticket` en la transacción de PostgreSQL. La auditoría se registra por la función SQL.
- El efecto es explícitamente `none`: invalida el ticket, pero no inicia ni promete reembolso. El flujo de anulación de ventas propias del trabajador y la gestión/conciliación de reembolsos siguen pendientes.
- Se añadieron pruebas de autorización por rol, motivo obligatorio, alcance tenant y llamada auditada. Resultado: typecheck frontend/API, build Vite y 81 pruebas en 17 archivos aprobadas. No se anuló ningún ticket en la base local.

### Editor de sorteos y agenda — 20 de octubre de 2026

- `/admin/sorteos` ahora crea y edita sorteos, códigos, hora/cierre, días activos, referencias generales y diarias, modalidades de 2/3/4 cifras, mínimos, incrementos, cupos y cantidad de suertes. También permite activar/desactivar el sorteo y continúa generando sesiones en la agenda existente.
- La API exige `admin` + `draw.create`, valida duplicados/límites y configura tenant/RLS en la transacción existente. Inserts/updates quedan registrados por los triggers de auditoría con motivo. Cambios de modalidad se bloquean cuando ya hay jugadas enlazadas, protegiendo ventas y premios históricos; las sesiones ya creadas conservan su horario y referencia.
- Se agregaron pruebas de permiso, validación de modalidad, persistencia tenant-scoped y bloqueo de cambios después de registrar jugadas. TypeScript frontend/API, build Vite y suite completa aprobados: 86 pruebas en 18 archivos. No se escribió en la base local.
- Sigue pendiente el editor de planes y versiones inmutables mediante `fn_new_plan_version`; el módulo de sorteos/planes permanece parcial hasta cerrarlo y hacer integración con una base de prueba.

### Editor de planes de premio — 20 de octubre de 2026

- Se completó `/admin/planes`, con creación y activación/desactivación de planes, asignación por sorteo/modalidad y edición mediante publicación de nuevas versiones inmutables de premios. La navegación, los accesos rápidos, la pantalla y la API exigen `admin` + `plan.edit`; la API valida tenant, modalidad activa y número/orden de suertes, y delega el versionado a `app.fn_new_plan_version`.
- Se agregaron tarjetas por plan, detalle de pagos por cada dólar jugado, estados de carga/error y formulario adaptable a móvil. La pantalla carga bajo demanda.
- En la verificación de aquel bloque: TypeScript de API/frontend, build Vite y suite aprobados: 91 pruebas en 19 archivos. La separación de `/admin/planes` en un chunk diferido se completó después.
- Esta actualización no escribió en PostgreSQL y no se hizo QA visual en navegador. La base de integración aislada y los recorridos E2E/RLS/concurrencia siguen pendientes; por eso sorteos y planes se mantienen como parcialmente verificados.

### Anulación de ventas propias desde POS — 20 de octubre de 2026

- La lista de ventas del trabajador ahora muestra tickets y ofrece anular los activos que el servidor determina elegibles. La API requiere `worker` + `ticket.void_own`, valida tenant y que la venta pertenezca al trabajador, exige motivo y bloquea el ticket durante la operación.
- `app.fn_void_ticket` mantiene la regla autoritativa de sesión no cerrada, ventana individual configurada y ausencia de premios pagados/en trámite. La acción se audita y usa efecto `none`, sin crear un reembolso automático. Vendedores no pueden usar esta acción.
- TypeScript frontend/API, Vitest (94 pruebas en 19 archivos) y build Vite aprobados. Entrada del frontend: 496.31 kB; vendor React separado: 436.41 kB. No se usó la BD local ni hubo recorrido visual E2E.
- Quedan por completar recuperación de compra de invitado con verificación fuerte y la consola de resolución/conciliación de reembolsos; los recorridos PostgreSQL aislado, RLS y concurrencia siguen siendo necesarios antes de certificar la fase.

### Cola de reembolsos — 20 de octubre de 2026

- Se creó `/admin/reembolsos`, visible y accesible solo para admin con `refund.manage`. La cola muestra los pendientes del tenant y datos suficientes para reconocer el pago, ticket y motivo.
- La API bloquea refund y pago, compara la suma de pendientes/completados contra el pago original, exige cuenta de egresos para pagos externos y llama a `app.fn_complete_refund`. Los reembolsos de billetera se acreditan en la billetera del cliente; los demás se marcan después de una devolución realizada manualmente, registrando el método y referencia. El sistema no efectúa transferencias bancarias.
- TypeScript de API/frontend, Vitest (100 pruebas en 19 archivos) y Vite build pasan. Entrada web: 461.25 kB; Vendor React separado: 436.41 kB. No se escribió en la BD ni se hizo QA visual E2E.
- Continúan pendientes el inicio general de un reembolso desde la UI, integraciones reales de pagos/devoluciones, recuperación de compras de invitado con OTP y pruebas PostgreSQL aisladas con RLS/concurrencia.

### Revisión comparativa de las referencias Gold y Hub — 20 de octubre de 2026

- Se revisaron las rutas, componentes, estilos y fixtures de `fortuna-gold-main` y `fortuna-hub-main`. Gold aporta el portal premium con encabezado horizontal, navegación móvil, inicio con saldo/sorteos, flujo de compra y ticket digital; Hub aporta pantallas de consulta, guía, resultados, premios, sorteos, rifas, recargas, contratas, comisiones, operación y administración. Sus pantallas usan fixtures/mocks y no se conectaron esos datos a la aplicación real.
- El sistema principal conserva la API/PostgreSQL y los permisos existentes. Se ajustó el shell hacia la composición Gold (encabezado horizontal, navegación principal, menú completo filtrado por permisos, navegación móvil y pie), y el inicio expone saldo y sesiones abiertas reales; desde cada sorteo se pasa el `sessionId` al flujo de compra.
- La comparación encontró enlaces del pie a `/consultar` y `/guia` sin destino en el sistema principal. Se añadió consulta pública por código que abre la verificación real del ticket (sin exponer datos personales) y una página de juego responsable. No se importaron credenciales PayPhone ni confirmaciones/pagos ficticios del prototipo Gold.
- Verificación de esta actualización: `tsc -b`, build Vite y 78 pruebas en 17 archivos aprobados. La inspección automatizada del navegador y los endpoints locales quedó impedida por las políticas de socket/browser de este entorno; no se afirma QA visual E2E ni que los puertos estén activos.
- Pendiente para concluir la integración global: revisar las funciones de Hub contra la matriz principal (`docs/AUDITORIA_PROMPT_MAESTRO.md`), completar las brechas funcionales documentadas y realizar QA navegador/API/DB cuando el entorno local permita acceso. Las dos carpetas de referencia se preservan.

## Estado al 19 de octubre de 2026

### Fuente de datos y base real

- El sistema se construye desde cero en `C:\Imperio_Ross`; el SQL original disponible está en la raíz del proyecto y no se ha modificado ni reejecutado.
- Se verificó PostgreSQL 18.6, base `imperio_de_ross`, esquema `app`, tenant `imperio-de-ross` activo y 61 tablas.
- El archivo indicado `database/imperio_de_ross_completo.sql` no existe en este workspace; el existente es `C:\Imperio_Ross\imperio_de_ross_completo.sql`.
- `rf_dev` es superusuario y miembro de ambos grupos. Se utiliza solo como cuenta de bootstrap/mantenimiento; el backend rechaza superusuarios para conexiones runtime.
- Se crearon `ir_api_staff`, `ir_api_admin` e `ir_migrator` con contraseñas aleatorias guardadas únicamente en `.env` (ignorado). Los logins de API son no-superusuario, sin `BYPASSRLS`, cada uno miembro de su grupo correspondiente; staff no puede leer `app.ticket_claim_codes`.
- Se aplicó `0001_schema_migrations.sql`, que creó `app.schema_migrations` y registró el checksum. El SQL base no se reejecutó.

### Implementado

- **Frontend cliente:** React + TypeScript estricto + Vite, navegación responsive, identidad de tenant, formularios de acceso/registro/recuperación y flujo de compra con carrito borrador, dinero en centavos, envío de comprobante y confirmación en revisión.
- **Pantallas cliente:** inicio, sorteos abiertos, tickets, resultados, rifas (lectura), billetera, movimientos, notificaciones y cuenta. Los datos se presentan desde la API; se protegen las consultas privadas y se muestran estados vacíos/error sin inventar datos.
- **Marca y PWA:** logos oficiales sin alterar los originales; manifest, service worker de recursos estáticos y pantalla offline. Navegación móvil, foco visible y soporte a `prefers-reduced-motion`.
- **API inicial:** Fastify, pools separados, resolución de tenant, contexto RLS, validaciones de rol, autenticación bcrypt/sesiones hash, endpoints de lectura del cliente y primer flujo de órdenes con idempotencia y almacenamiento privado de comprobantes.
- **Bootstrap local:** `npm run db:bootstrap:local` crea los logins de mínimo privilegio solo para `localhost/imperio_de_ross`, rechaza sobrescribir `.env` y no ejecuta el SQL base.
- **Cuentas DEMO:** `admin`, `worker`, `seller` y `client` ya existían como fixtures, pero sus hashes eran marcadores. Se reemplazaron por hashes bcrypt, sin duplicarlos ni cambiar roles/permisos. Credenciales locales en `.local/demo-usuarios.txt`; seed controlado por `npm run db:seed:demo-users` y limitado a desarrollo/local.
- **Administración:** revisión de comprobantes conectada a la API y funciones SQL. Nueva pantalla `/admin/resultados`: consulta sesiones elegibles y publica/corrige resultados con versionado, motivo, idempotencia y procesamiento de premios mediante `fn_register_result`.
- **Verificación de tickets:** ruta pública `/verificar/:codigo` y API con limitación de tasa; solo expone estado y datos de juego, con impresión, descarga PDF con marca y QR, y compartir.
- **Billetera y recargas:** el cliente envía solicitud idempotente con comprobante privado, revisa el estado y puede corregir una rechazada. Administración aprueba/rechaza mediante `fn_review_recharge`; solo la aprobación acredita por ledger y asiento financiero.
- **Premios y retiros:** el cliente consulta premios propios, acredita un premio a su billetera o solicita retiro. Admin/trabajador puede validar tickets; el pago exige permiso SQL y, para trabajador, local asignado. Administración procesa transiciones de retiro permitidas por `fn_advance_withdrawal`, exige motivo para rechazar/cancelar y referencia al marcar pagado.
- **Panel administrativo:** resumen de ventas aprobadas de hoy, compras pendientes, retiros, premios, clientes activos y sesiones abiertas; solo disponible con permiso `report.view`.
- **Usuarios y permisos:** administración puede crear trabajadores/vendedores con clave hasheada, asignar local, buscar/paginar usuarios, desactivar cuentas no administrativas (revoca sesiones), configurar autorizaciones individuales y modificar permisos editables por rol con motivo. Cambios de acceso se guardan en `audit_log`; permisos reservados a admin y cuentas admin están protegidos.
- **Cierre de sesión:** el logout revoca la sesión en PostgreSQL, elimina la cookie y limpia la caché privada del navegador.

### Verificación ejecutada

- `npm test`: 9 pruebas aprobadas.
- `npm run build`: TypeScript frontend y build de Vite aprobados.
- `npm run typecheck:api`: aprobado tras agregar el bootstrap.
- La API inició con las comprobaciones de rol habilitadas; `/health/ready` respondió `ready`.
- Llamadas reales de solo lectura: tenant correcto; 18 sorteos abiertos; 0 resultados publicados; 2 métodos de pago. `/api/tickets` sin sesión devolvió 401 `AUTH_REQUIRED`.
- La primera consulta de sorteos encontró un error al agrupar JSON; se cambió a JSONB y se comprobó que devolviera sorteos reales.
- No se enviaron órdenes ni se hicieron operaciones financieras de prueba.
- Capacitor, APK/AAB e IPA todavía no están configurados ni compilados.

### Pendiente

- Frontend administrativo restante: configuración de sorteos y POS.
- Backend restante: mantenimiento de sorteos, vendedores/comisiones, contratas, jugadas programadas, compra de rifas, finanzas, caja, permisos administrativos y auditoría detallada.
- Recuperación/cambio de contraseña y verificación de contacto cuando estén disponibles correo/SMS reales.
- Pruebas de integración PostgreSQL y recorridos end-to-end de dinero, permisos, tenant, concurrencia y estados.
- Capacitor y adaptadores móviles para cámara/QR, compartir, descargas y notificaciones.

### Ejecución

- `.env` local contiene las URLs generadas para staff, admin y migrador; no incluirlo ni compartir sus claves.
- API actualmente iniciada en `http://127.0.0.1:3000` durante esta sesión.
- Para frontend: `npm run dev -- --open` (si el shim de Node no está activo, anteponer al `PATH` la instalación Node 22 indicada en README).
- Para detener la API de desarrollo, usar `Ctrl+C` en su terminal de ejecución.

### Ejecución de desarrollo actual

- API: `http://127.0.0.1:3000` (estado ready).
- Frontend: `http://127.0.0.1:5173` (HTTP 200).
- CORS comprobado desde `http://127.0.0.1:5173`; el endpoint de sorteos devolvió 18 sesiones desde PostgreSQL.
- El bundle web quedó dividido en chunks React, router, query e iconos; compilación final sin advertencia de tamaño.

### Módulo de revisión administrativa — 19 de octubre de 2026

- Se agregó la pantalla responsive de Revisión de pagos, visible para roles admin/worker. Presenta compras pendientes, comprador, líneas de jugada, referencia y metadatos del comprobante.
- La API enruta `/api/admin/*` por el pool `ir_api_admin`, valida `app.fn_can(..., 'order.approve')` y usa `fn_review_order`/`fn_reject_order`; los archivos solo se sirven al personal autorizado tras verificar orden y tenant.
- Endpoint de cola comprobado sin sesión: devuelve 401. La acción aprobada/rechazada no se ejecutó durante esta verificación para evitar alterar ventas reales.
- Typecheck API, 9 pruebas unitarias y build web aprobaron después de integrar la pantalla.
- Las cuatro cuentas DEMO completaron login, consulta de sesión y logout en la API. La cola de resultados rechaza solicitudes sin sesión (401) y funciona con admin; no había sesiones con sorteo ya realizado.
- Ticket público: el endpoint no requiere login; el código inválido y el código válido no existente responden 404 sin divulgar información. El frontend responde HTTP 200.
- Recargas: la cola de administración respondió 200 para admin y 403 para worker; el cliente consultó su historial y opciones (200), mientras worker recibió 403. No se envió un comprobante ni se creó saldo de prueba.
- Resultado: `npm run typecheck:api`, `npm run build` y `npm test` (9 pruebas) aprobados. No se registraron resultados ni se ejecutaron acciones financieras.
- Premios/retiros: las rutas nuevas rechazaron acceso sin sesión (401); el cliente obtuvo su lista propia (200) y no pudo validar (403). La administración consultó la cola de retiros (200), mientras worker/vendedor/cliente recibieron 403. Las cuatro cuentas iniciaron y cerraron sesión; `GET /api/auth/me` pasó a 401 tras logout. No se pagaron premios ni se crearon/revisaron retiros.
- Dashboard: admin recibió 200; worker, vendedor y cliente recibieron 403. Locales de pago: admin y trabajador autorizado recibieron 200; vendedor recibió 403. La lista contiene locales activos y restringe al trabajador a su local asignado.
- Usuarios/permisos: admin consultó usuarios y las 32 entradas de la matriz (200); worker/vendedor/cliente recibieron 403. No se modificaron permisos ni cuentas durante la prueba.
- Pruebas aisladas de rutas administrativas confirman que roles no-admin no leen usuarios/permisos, que una cuenta admin no puede auto-desactivarse y que las acciones admin-only no se pueden delegar. Estos casos se ejecutan con Fastify inject y base simulada, sin `PATCH` a la base local.
- Verificación actual de este avance: typecheck backend/frontend, build y 13 pruebas unitarias (incluidas 4 nuevas de control administrativo) aprobados. El API informó `ready`, admin leyó 5 cuentas y 3 locales; frontend HTTP 200.
- Verificación final de este bloque: typecheck API, build frontend y 9 pruebas unitarias aprobados; frontend 200 y API ready 200.

### Agenda administrativa de sorteos — 19 de octubre de 2026

- Se agregó `/admin/sorteos`, restringido en navegación, pantalla y API al rol admin con permiso `draw.create`.
- La agenda consulta sesiones existentes, zona horaria, horarios, días activos, modalidades y referencias diarias desde PostgreSQL.
- El administrador puede generar sesiones faltantes con horizonte de 1 a 30 días. El cálculo usa la zona horaria del tenant y respeta el cierre configurado; conflictos de fecha se omiten sin modificar sesiones existentes.
- Se mostraron estados de carga/error/vacío y confirmación basada en el número de sesiones insertadas. No se publicó ningún resultado ni se cambiaron sesiones en la base al construir este módulo.
- Verificación: `tsc --noEmit -p tsconfig.server.json`, compilación TypeScript del frontend, build de Vite y 13 pruebas unitarias aprobados. La consulta HTTP local no se pudo verificar en esta ejecución porque el entorno denegó el acceso al socket `127.0.0.1:3000`.

### Integración de fortuna-hub y fortuna-gold — 19 de octubre de 2026

- Se alineó la paleta y el contrato de tokens del sistema principal con `fortuna-gold-main`; se mantuvieron las rutas, sesión, servicios y backend propios de `C:\Imperio_Ross`.
- `/admin/auditoria` consulta `audit_log` real con búsqueda, paginación y filtro de tenant; servidor limita el acceso a admin con `report.view`.
- El centro de notificaciones muestra el contador sin leer y permite marcar una o todas como leídas; las escrituras están limitadas al usuario autenticado.
- Se integró `/pos` para trabajadores y vendedores: registro de venta en efectivo con confirmación de mayoría de edad y términos, validación de números/modo/plan en PostgreSQL, idempotencia, emisión transaccional de tickets, consulta de ventas propias y comisiones del vendedor.
- Se agregó y aplicó `0002_pos_register_permission.sql` en la base local usando la cuenta `rf_dev`; crea `sale.register` para admin/trabajador/vendedor solo cuando no existía, preservando permisos ya personalizados.
- Rifas especiales ya permiten comprar números con la billetera para cuentas cliente: idempotencia, confirmación de edad/términos, saldo verificado en servidor y revelación de números generados por PostgreSQL.
- Se configuró Vitest para ejecutar solo pruebas de `src/` y `server/` del sistema principal, sin recoger suites de las carpetas de referencia.
- Verificación: TypeScript frontend y backend, build Vite y 24 pruebas unitarias aprobados. API local: `/health/ready` 200, `/api/raffles` 200 con 3 rifas; rutas POS/auditoría y ambos POST nuevos devuelven 401 sin sesión. No se hizo una venta real de POS ni una compra/operación financiera en la base.
- En ese corte todavía faltaban contratas, jugadas programadas, comisiones, reportes/caja y transferencias de rifas; esos bloques se completaron más abajo en este registro. Las carpetas de referencia siguen presentes hasta concluir la integración global; no se han borrado.

### Jugadas programadas — 19 de octubre de 2026

- Se integró `/jugadas-programadas` con presentación alineada a los tokens Gold y acceso exclusivo de cuentas cliente.
- La API consulta programaciones, billetera, historial inmutable y ejecuciones reales del usuario autenticado; crear valida sorteo, modalidad, plan vigente, mínimo de importe, días y formato del número en PostgreSQL.
- Pausar, reactivar y cancelar solo permite cambiar programaciones activas/pausadas propiedad del usuario. Los cambios generan el historial mediante el trigger de PostgreSQL.
- La base contiene `fn_execute_scheduled_play`, que crea la orden o registra saldo insuficiente sin descuento parcial. La ejecución periódica de esa función aún no se habilitó: el SQL también inserta una programación demo activa, así que primero hay que revisar su fecha/saldo y definir el proceso scheduler para evitar débitos inesperados.
- Pruebas: 4 nuevas pruebas de autorización/validación y suite completa de 28 pruebas aprobadas; TypeScript de frontend y API aprobado; build Vite aprobado.

### Integración adicional: diseño, contratas y comisiones — 19 de octubre de 2026

- Se creó en Lovable el taller no publicado **Ross Fortuna Studio** para producir un patrón visual premium de cliente, compra y administración. El código generado se usó como referencia, no como reemplazo de la aplicación conectada a PostgreSQL. Se trasladaron a la aplicación principal superficies Gold con degradados/sombras suaves, estados animados accesibles, realce táctil, safe areas y prioridad de Contratas en la barra móvil del vendedor.
- `/contratas` permite que Administración asigne cupos a un vendedor y configure sorteo, número, plan, días, fechas, cobro o crédito autorizado. Los slots se materializan sobre sesiones ya existentes; vendedores solo ven sus asignaciones y pueden registrar un cupo antes del cierre. El flujo invoca `fn_sell_contrata_slot` con idempotencia; el crédito y cuentas por cobrar quedan trazables. La API no ofrece billetera para contratas hasta vincular el cliente a una cuenta.
- `/admin/comisiones` permite configurar regla porcentual, fija o utilidad mensual por alcance, fechas y desactivación con motivo. `/pos` mantiene visible al vendedor su propio historial de comisiones. Los alcances y ventanas duplicados se rechazan para que el cálculo SQL no escoja una regla ambigua.
- Se agregó y aplicó `0003_commission_manage_permission.sql` en el tenant local: crea `commission.manage` únicamente cuando no existía, solo admin, y preserva personalizaciones. La cuenta migradora no tiene permisos para `role_permissions`; la migración se aplicó con la conexión administrativa aprobada y checksum registrado por el migrador.
- La liquidación mensual en el SQL original no aplica la fecha de vigencia. Por eso la pantalla fuerza una regla mensual activa desde hoy y la mantiene hasta que Administración la desactive; la fecha futura/fin no se presenta como disponible. La función puede ser corregida en una migración posterior cuando se use la cuenta propietaria del objeto `postgres`.
- Verificación del bloque: typecheck frontend/API y 36 pruebas (10 archivos) aprobados. No se crearon contratas, ventas, crédito ni comisiones en datos de negocio durante la implementación.

### Finanzas, reportes y caja — 19 de octubre de 2026

- Se agregó `/admin/finanzas` con resumen de entradas/salidas, neto, actividad diaria e historial de cierres, filtrados por periodo/local, desde `financial_transactions` y `cash_closings` reales.
- La vista de caja consulta `fn_cash_preview` y presenta apertura, ingresos, transferencias, premios, gastos, retiros y esperado. El cierre requiere `cash.close`, solo acepta el día actual y delega el registro inmutable, auditoría y notificación de diferencias a `fn_close_cash`.
- Se añadió transferencia interna entre cuentas activas del mismo tenant. Exige `finance.manage`, valida ambas cuentas antes de llamar `fn_internal_transfer`, que genera los movimientos pareados y auditoría.
- El reporte exige `report.view`; ambas rutas son exclusivas del rol admin y verifican permiso individual con `fn_can`. No se agregaron permisos ni se registraron cierres/movimientos de negocio.
- Verificación: compilación TypeScript frontend, typecheck API y 41 pruebas (11 archivos) aprobados; 5 pruebas nuevas cubren rol y permisos, chequeo del monto, vista previa y prevención de transferencias a cuentas fuera del tenant.

### Administración de rifas y Números Fortuna — 19 de octubre de 2026

- `/admin/rifas` permite crear rifas solo como borrador con rango, cifras, precio, modalidad/fechas de cierre, premio, reglas y método. El administrador abre o cierra mediante transiciones permitidas; las fechas y cantidades se validan antes de insertar.
- Los paquetes y Números Fortuna solo pueden configurarse en borrador. La API valida cifras/rango, conserva ceros iniciales, impide duplicados y deja la asignación de números ganadores exclusivamente al trigger/función de negocio.
- La cola de participaciones pendientes usa `fn_approve_raffle_purchase`; al aprobar, la base asigna y revela números. El rechazo actualiza participación y pago con motivo. Los comprobantes se sirven en privado tras verificar rol/permisos, tenant, compra y ruta segura de almacenamiento.
- Se agregó y aplicó `0004_raffle_manage_permission.sql`; verificación local devolvió admin=true y client/worker/seller=false. El runner reconoció el checksum aplicado.
- El logout ahora limpia la caché privada y navega a `/acceso` con reemplazo de historial tras respuesta exitosa del servidor.
- `/api/auth/me` ahora incluye los permisos efectivos por rol. El menú filtra módulos según rol, permiso y configuración del tenant; `raffle.manage` se presenta como reservado a administración en la matriz editable.
- Verificación: typecheck de frontend/API, build Vite y 45 pruebas (12 archivos) aprobados. La base local solo recibió los permisos; no se crearon rifas, paquetes, pagos ni movimientos financieros durante la implementación.

### Compra de rifas por transferencia — 19 de octubre de 2026

- La compra de rifas especiales ahora admite billetera y transferencia bancaria; el cliente elige una cuenta destino, adjunta JPG/PNG/PDF de hasta 5 MB y envía el comprobante a revisión.
- La API aplica mayoría de edad registrada, método habilitado, cuenta activa del tenant, prueba de contenido MIME, hash anti-reutilización e idempotencia. Al transferir queda pendiente y no revela números; se muestran al aprobarse desde la cola administrativa existente.
- `/rifas` muestra el historial privado del cliente y únicamente revela sus números aprobados. El flujo actualiza historial, rifas y saldo tras la compra; deshabilita checkout durante carga/error o si no hay métodos activos.
- Se añadieron pruebas para permisos y confirmaciones, además de las validaciones de cuenta bancaria y comprobante obligatorios. Verificación: typecheck frontend/API, build Vite y suite completa con 47 pruebas (12 archivos) aprobados. No se ejecutaron compras ni se escribieron operaciones de negocio en la base durante esta fase.

### Cobranza de crédito de Contratas — 19 de octubre de 2026

- `/admin/finanzas` ahora muestra las cuentas por cobrar abiertas y parciales de Contratas, el saldo, los pagos previos, sorteo, vencimiento y referencia de compra.
- Administración con `finance.manage` puede registrar pagos parciales o liquidar el saldo. El servidor impide importes mayores al pendiente, protege la operación con idempotencia y ejecuta `fn_receive_receivable_payment`, que actualiza cobranza, registra transacción financiera y auditoría dentro de la transacción de PostgreSQL.
- Se añadieron rutas documentadas, interfaz responsive e historial de abonos. Typecheck frontend/API, build Vite y suite completa con 51 pruebas (12 archivos) aprobados; las pruebas cubren autorización, sobrecobro y abono parcial válido por la función SQL. No se registraron cobros ni se tocaron filas de negocio en la base.

### Scheduler seguro de jugadas programadas — 19 de octubre de 2026

- Se implementó un worker periódico con pool administrativo sujeto a RLS que selecciona sesiones del día configurado dentro de los próximos cinco minutos al cierre y llama `fn_execute_scheduled_play` en una transacción por jugada.
- La activación requiere `SCHEDULED_PLAYS_ENABLED=true` y una allowlist explícita de UUIDs en `SCHEDULED_PLAYS_TENANT_IDS`; el valor por defecto permanece apagado. El job exige el módulo habilitado, ignora usuarios demo, bloquea filas concurrentes y la función SQL previene ejecuciones duplicadas por sesión.
- Se configuraron intervalo, ventana y límite por tenant; se registran resultados y códigos de error sin contenido de excepciones. Se actualizó la documentación de PWA, almacenamiento y proveedores externos.
- Verificación: TypeScript frontend/API, build Vite y suite completa con 54 pruebas (13 archivos) aprobados; 3 pruebas nuevas cubren ejecución de sesión elegible, ausencia de cargo sin sesión y rollback ante error. El scheduler no se activó y no se ejecutaron jugadas ni débitos en la base local.

### Preparación Capacitor — 20 de octubre de 2026

- Se agregó `capacitor.config.json` apuntando al build `dist/` y la guía `docs/MIGRACION_MOVIL.md` con instalación, sincronización y apertura de Android/iOS.
- El registro del service worker se omite cuando corre dentro del runtime nativo; la PWA mantiene su shell estático web sin cachear `/api/`.
- La instalación de Capacitor 8 no pudo completarse: `registry.npmjs.org` devolvió `ENOTFOUND` en este entorno. No se agregaron dependencias al lockfile ni se crearon proyectos nativos; tampoco se generaron APK/AAB/IPA. Requiere conectividad npm y toolchain Android o Xcode.

### Números favoritos — 20 de octubre de 2026

- Se añadió `/favoritos` para que clientes agreguen y eliminen números de 2–4 cifras, con etiqueta opcional y conservación de ceros iniciales. El menú del cliente incluye el acceso.
- La API usa `app.favorite_numbers`, permite solo el rol `client`, filtra todas las operaciones por tenant y propietario, valida la longitud e informa duplicados. No se alteró la base de datos.
- Se documentaron las rutas y permisos y se añadieron pruebas para autorización, validación, ceros iniciales y borrado del propietario. Typecheck frontend/API, build de Vite y suite completa aprobados: 59 pruebas en 14 archivos. No se insertaron datos en la base local.

### Auditoría de prompts y continuación — 20 de octubre de 2026

- Se revisaron los prompts maestros, Fase 1 y actualización de diseño frente a rutas, módulos, API, documentación y esquema SQL. `docs/AUDITORIA_PROMPT_MAESTRO.md` registra los 38 apartados, matriz de módulos, 12 criterios de Fase 1, brechas y orden de continuación. La auditoría concluye que el sistema sigue en curso y que hay pendientes principales y verificaciones E2E; no se declara terminado.
- Se encontró desactualizada la documentación sobre el scheduler y módulos administrativos; se corrigió `docs/API.md`, `docs/ARQUITECTURA.md` y `docs/PLAN_IMPLEMENTACION.md` para describir el estado actual y enlazar el checklist.
- Se cerró la acción inmediata de favoritos: cada favorito ofrece “Revisar”, que abre Comprar con el número y modalidad prellenados; no agrega ni compra automáticamente y muestra una instrucción de revisión. La conectividad HTTP en vivo hacia `127.0.0.1:5173` y `:3000` no fue accesible desde este entorno, por lo que no se afirma una verificación E2E del navegador/API/DB.
- Verificación tras estos cambios: TypeScript API y frontend, build Vite y suite completa con 59 pruebas en 14 archivos aprobados. No se escribieron datos en PostgreSQL.

### Perfil personal y cambio de contraseña — 20 de octubre de 2026

- /cuenta permite actualizar nombre, teléfono y correo, con normalización, protección de unicidad por tenant y registro mediante el trigger de auditoría existente; no acepta cambios de rol ni local.
- El cambio de contraseña requiere la contraseña actual, guarda hash bcrypt, invalida las sesiones activas y devuelve una sesión nueva en cookie HttpOnly. Se limitan los intentos; no requiere alterar el esquema.
- Se añadieron pruebas de contacto único, conflicto concurrente con rollback a savepoint, contraseña actual incorrecta, cambio y revocación de sesiones. TypeScript frontend/API y build Vite aprobados; suite completa: 64 pruebas en 15 archivos. No se modificó la base ni sus datos.

### Recuperación de compras de invitado — 20 de octubre de 2026

- Se agregó la pantalla pública `/recuperar-compra`, enlazada desde `/consultar`, para buscar por código de compra/ticket y el teléfono usado al comprar.
- La API usa las funciones `app.fn_find_guest_order` y `app.fn_check_otp`, liga el OTP al tenant, teléfono normalizado y código, persiste HMAC (no el código), limita solicitudes e intentos, y solo devuelve detalles de la compra invitada después de validar el OTP. La respuesta inicial es genérica y no confirma si hay coincidencia.
- El OTP demo `123456` funciona exclusivamente con `NODE_ENV=development` desde loopback; no hay entrega SMS fingida. Para producción hace falta integrar proveedor SMS. La compra y sus líneas se consultan desde PostgreSQL; no se guardan en localStorage.
- Verificación en esa fase: typecheck de API y frontend, 105 pruebas en 20 archivos y build Vite aprobado. No se escribió en la base local ni se ejecutó QA visual/API contra la BD.

### Solicitud administrativa de reembolso — 20 de octubre de 2026

- `/admin/reembolsos` permite crear solicitudes parciales o totales con código de compra, importe USD y motivo. Solo un admin con `refund.manage` puede crearlas.
- La API bloquea el pago y comprueba el saldo reservado antes de insertar la devolución pendiente; el trigger de PostgreSQL registra la auditoría. La solicitud no se liquida anticipadamente: permanece en la cola que acredita billeteras o registra la devolución externa ya ejecutada.
- Se añadieron pruebas para permiso requerido, sobrepaso del saldo y creación pendiente sin pago adelantado. TypeScript API/frontend, 108 pruebas en 20 archivos y build Vite pasan; entrada web 474.53 kB, vendor React 436.41 kB.
- No se creó ninguna solicitud en la base local. El servidor frontend y la API local no eran accesibles desde el sandbox, así que la validación de navegador/BD sigue pendiente.

### Dominio del tenant y estado de locales — 20 de octubre de 2026

- La configuración de marca permite guardar un dominio DNS personalizado opcional, valida hostname (sin protocolo/ruta), comprueba unicidad y lo agrega al registro auditado. El slug sigue disponible; para usar el host personalizado, el DNS debe apuntar a la instalación.
- Administración ahora ve locales activos e inactivos y puede reactivarlos. Desactivar exige motivo auditado y se bloquea mientras existan cuentas activas asignadas; el selector de nuevas cuentas solo muestra locales activos.
- Se añadieron pruebas de validación/colisión/normalización de dominio y de reactivación/protección de locales. TypeScript API/frontend, suite completa con 113 pruebas en 20 archivos y build Vite pasan; chunk principal 475.53 kB y vendor React 436.41 kB.
- No se modificaron registros locales de tenants o sucursales. El navegador y API locales no admitieron conexiones desde el sandbox; verificación de DNS y flujo vivo queda pendiente.

### Panel de actividad del vendedor — 20 de octubre de 2026

- Se agregó `/vendedor`, protegido por sesión, rol `seller` y permiso `sale.register`, con accesos a nueva venta y gestión de Contratas.
- El panel consulta los endpoints autenticados de ventas propias, comisiones y Contratas; muestra tickets emitidos, estados de comisión y avance/recaudación de cupos. Errores y estados vacíos incluyen reintento.
- Se integró al inicio, menú y navegación móvil del vendedor. No se ampliaron permisos ni se modificó la base de datos.
- Verificación: typecheck de API/frontend, build Vite y suite con 113 pruebas en 20 archivos aprobados. Navegador y PostgreSQL local no fueron accesibles en este entorno; queda pendiente QA E2E por rol y confirmación de datos reales.

### Diagnóstico administrativo de sistema — 20 de octubre de 2026

- Se agregó `/admin/prueba-completa`, disponible para `admin` con `report.view`. El diagnóstico consulta salud de API y ambos pools de PostgreSQL, tenant, sorteos/resultados, sesión/notificaciones y rutas de los módulos concedidos a la cuenta.
- Todas las sondas son GET; la pantalla no altera compras, tickets, saldos ni sorteos. Filtra las rutas según rol/permisos y diferencia rutas rechazadas por permisos de servicios no disponibles.
- Se agregó acceso al menú administrativo, carga diferida y estados responsive. No requiere migración ni cambios en PostgreSQL.
- Verificación: TypeScript de API/frontend y build de producción aprobados. No se añadieron pruebas automatizadas ni se ejecutaron operaciones de negocio.

### Inventario de datos DEMO — 20 de octubre de 2026

- Se agregó `/admin/datos-demo` y `GET /api/admin/demo/status`, limitado a `admin` con `report.view` y al tenant de la sesión. La API devuelve solo conteos agregados, sin PII ni importes, de cuentas, sorteos/sesiones/planes, compras/tickets/resultados/premios, comisiones/Contratas, jugadas, rifas, notificaciones y auditoría que se puedan identificar como DEMO.
- La pantalla distingue capacidades conectadas de integraciones aún sin proveedor y enlaza al diagnóstico de solo lectura. No ejecuta seeds, transacciones financieras ni reinicios desde el navegador.
- Compilación API/frontend y build Vite aprobados. En la instalación local, el endpoint respondió 200 y devolvió cuatro cuentas DEMO, un sorteo, dos sesiones, un plan de jugadas, un resultado, un premio y una jugada programada. En la fase siguiente se añadieron una segunda orden/ticket DEMO, una comisión y una segunda Contrata asignada al vendedor.
- El recorrido guiado de compra→aprobación→ticket→resultado→premio y su reinicio en almacenamiento DEMO aislado aún no se implementan.

### Ventas, comisiones y Contratas del vendedor — 20 de octubre de 2026

- Se agregó `database/scripts/seed-demo-seller.mjs`, un seed transaccional e idempotente que solo admite `localhost/imperio_de_ross` en desarrollo. Agrega una venta de 25 centavos marcada DEMO, una comisión de ventas del 10% asociada al vendedor DEMO y una Contrata DEMO con dos cupos reservados. No vende los cupos ni cambia saldos.
- Se verificó que el vendedor tenga `sale.register` y local asignado; los permisos de configuración `commission.manage`/`finance.manage` siguen limitados a administración. El usuario y el rol son filas DEMO existentes; la matriz configurable vive en `role_permissions` y no hizo falta crear tablas duplicadas.
- La consulta `/api/pos/sales` fallaba por un alias SQL usado antes de incorporarse al `JOIN`; se corrigió y ahora las rutas de vendedor responden las ventas propias, la comisión propia y la Contrata asignada.
- Verificación viva con login/logout: vendedor obtuvo 1 venta DEMO, 1 comisión y 1 Contrata; administración consultó usuarios, 40 permisos, 4 planes de comisión y opciones de Contrata. Los cuatro roles iniciaron y cerraron sesión; trabajador consultó POS (200) pero no comisiones (403), y cliente recibió 403 en POS/Contratas. La prueba no publicó resultados ni vendió cupos.
- Para repetir el seed local: `$env:NODE_ENV='development'; node --env-file=.env database/scripts/seed-demo-seller.mjs`. Se ejecutó dos veces; el conteo siguió en 1 venta, 1 comisión y 2 cupos. El índice único por `idempotency_key` hace que la venta no se duplique.
- No se crearon tablas/vistas adicionales porque el esquema existente ya incluye `orders`, `commissions`, `commission_plans`, `role_permissions`, `users`, `contratas` y `contrata_slots`; los datos DEMO se escribieron ahí usando funciones SQL existentes.
- Verificación final: `tsc --noEmit -p tsconfig.server.json`, `tsc -b` y `vite build` aprobados. `dist` generado con las rutas administrativas de usuarios/permisos/planes empaquetadas.

### Revisión del prompt maestro FullStack/PostgreSQL — 20 de octubre de 2026

- Se contrastó `C:\Users\Admin\Downloads\Prompt_Maestro_Imperio_de_Ross_FullStack_PostgreSQL.txt` con SQL, rutas, pantallas, documentación y API local. El Word funcional que cita ese TXT no apareció en `Downloads`; las reglas de ese archivo quedan sin cotejar.
- Se habilitó `/api/v1` para toda la API mediante rewrite compatible; el cliente HTTP central ya envía rutas versionadas y `/api` sigue operativo. Se agregó OpenAPI 3.1 generado desde `docs/API.md` (`npm run docs:openapi`) en `/api/v1/openapi.json`, solo en desarrollo.
- Se corrigió `/api/wallet`: la lectura ahora usa `amount_cents`, `balance_before_cents` y `balance_after_cents`, que son las columnas reales de `v_wallet_statement`.
- Se creó `database/scripts/seed-demo-raffle.mjs` con rifa abierta DEMO, paquete de cuatro oportunidades, dos Números Fortuna, dos cuentas contables DEMO y una notificación interna. Se ejecutó dos veces; no duplicó filas. No crea una compra ni pago.
- `/admin/datos-demo` ahora cuenta pagos/comprobantes de compra, participaciones/paquetes/Números Fortuna, recargas, retiros, cuentas financieras y cierres. El endpoint v1 devolvió cuatro usuarios demo, dos compras/tickets, un premio, una comisión, dos Contratas, una rifa, dos números Fortuna, dos pagos, dos cuentas contables y un retiro pendiente. Comprobantes, compras de rifas, recargas y cierres siguen en cero.
- Verificación viva: cliente consultó billetera, 1 ticket, 1 premio, notificaciones y rifa; administración consultó inventario. La API reportó OpenAPI 3.1 con 63 rutas únicas; ambas sesiones terminaron con logout 204. `http://127.0.0.1:5173/` respondió 200.
- Chequeos aprobados: `tsc --noEmit -p tsconfig.server.json`, `tsc -b` y `vite build`. Se añadieron `docs/BASE_DATOS_Y_RLS.md` y se actualizó arquitectura/auditoría para reflejar los hechos.
- Pendientes expresos del prompt: Swagger UI y modelos DTO completos; cubrir comprobantes, compras de rifas, recargas y cierres con fixtures consistentes; pagos externos, OTP/correo/push productivos; prueba RLS multitenant y concurrencia con DB desechable; recorrido UI integral; app Android/iOS compilada. El retiro se dejó pendiente sobre premio DEMO y no se confirmó pago.
