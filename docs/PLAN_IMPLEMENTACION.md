# Plan técnico de implementación

La revisión requisito por requisito de los prompts compartidos está en [`AUDITORIA_PROMPT_MAESTRO.md`](./AUDITORIA_PROMPT_MAESTRO.md). Ese checklist es la fuente vigente para distinguir módulos completos, parciales y pendientes; no se declara el sistema terminado mientras haya criterios obligatorios sin verificar.

## Estado verificado

- Raíz: `C:\Imperio_Ross`. La base de referencia es `imperio_de_ross_completo.sql` (PostgreSQL 15+), que ya contiene el modelo operativo, funciones transaccionales, vistas, RLS y roles de grupo `rf_api_admin` / `rf_api_staff`.
- Frontend iniciado en React 19, TypeScript estricto, Vite, React Router y TanStack Query. Los logos originales están en `logos/` y se copian sin transformación a `public/brand/`.
- PostgreSQL local verificado: base `imperio_de_ross`, esquema `app`, tenant `imperio-de-ross`, 61 tablas. El SQL base no se volvió a ejecutar.
- Logins locales de mínimo privilegio configurados y credenciales fuera del repositorio. Migraciones incrementales registradas en `app.schema_migrations`.

## Orden de trabajo

1. Cerrar autenticación y pantallas de cliente, compra, comprobantes y consulta de resultados.
2. Continuar administración con mantenimiento de sorteos, premios/retiros y control de caja.
3. Completar dominios por permisos SQL: POS, vendedores/contratas, rifas, finanzas y caja.
4. Completar integraciones de notificación, PWA y preparación Capacitor con caché estática sin datos privados.
5. Añadir pruebas de integración/end-to-end en una base aislada y completar documentación operativa.

## Módulos completados en este avance

- Se habilitaron hashes bcrypt para los cuatro usuarios demo ya sembrados; no se duplicaron usuarios ni se imprimieron contraseñas en logs. Credenciales locales: `.local/demo-usuarios.txt`.
- Revisión de comprobantes conectada a la cola y las funciones SQL de aprobación/rechazo.
- Recargas de billetera: formulario e historial del cliente, comprobante privado, idempotencia y cola administrativa limitada a `admin`; crédito transaccional mediante `fn_review_recharge`.
- Administración de resultados consulta sesiones, publica/corrige usando `fn_register_result`, impide cambios repetidos y bloquea publicación antes de la hora del sorteo.
- Dashboard administrativo con métricas reales y control `report.view`.
- Gestión de usuarios por búsqueda/paginación, bloqueo/revocación de sesiones y edición auditada de permisos individuales y de rol para trabajador/vendedor.
- Operación de premios y retiros conectada a las funciones transaccionales SQL con control de propietario, autorización y local.
- Cobranza de crédito de Contratas y scheduler opt-in de jugadas programadas; PWA con shell estático sin cachear datos privados.
- Favoritos persistidos por usuario/tenant con validación de duplicados; desde cada favorito se prellena una jugada revisable en Comprar.
- Perfil personal editable y cambio de contraseña con verificación de contraseña actual, auditoría de cambios de perfil y revocación/rotación de sesiones.
- Consola administrativa de marca/configuración del tenant con controles de formato, revisión optimista y auditoría. La migración 0005 se aplicó con acceso administrativo; se verificó `tenant.manage=true` solo para admin y `false` para client/seller/worker.
- Gestión de locales en Usuarios y permisos: alta y edición auditadas de nombre/ciudad/dirección, prevención de duplicados y reversión a savepoint ante conflictos concurrentes.
- Logout revoca la sesión y limpia la cookie en API; el frontend vacía la caché y reemplaza la ruta por `/acceso`. Se agregó prueba API para revocación, cookie y estado 204.
- La matriz de permisos y los perfiles existentes no se elevaron ni alteraron.

## Decisiones de seguridad

- El SQL base es de instalación inicial y no se correrá contra bases existentes.
- El cliente solo envía comandos y borradores; el backend recalcula, valida autorización y usa funciones SQL atómicas.
- Las tablas de negocio consultadas respetan RLS; cada transacción configura `app.tenant_id` y `app.user_id` desde la identidad/tenant resueltos por servidor.
- El SQL crea roles de grupo `NOLOGIN`. Las credenciales de los logins miembros serán configuración externa; no se guardarán en el repositorio.
- Pasarela, correo/SMS y push requieren credenciales externas; las pantallas no simulan confirmaciones. El almacenamiento privado funciona en disco local y necesita volumen persistente/respaldo en despliegue.

## Límites actuales

La API local está conectada a PostgreSQL y ya se han comprobado rutas de lectura y permisos por rol contra las cuentas demo. Aún faltan pruebas de aislamiento RLS multitenant, concurrencia y recorridos E2E. El fixture local usó únicamente la billetera del cliente DEMO por 25 centavos; no usar cuentas reales ni sorteos oficiales para pruebas financieras adicionales. La ejecución automática programada permanece desactivada hasta configurar su allowlist de tenants.

Brechas funcionales identificadas en la auditoría: activación segura de tenants; CRUD completo de sorteos; recuperación de contraseña con entrega real y proveedor SMS para habilitar recuperación de compras fuera del modo local; verificación de contacto/2FA; gestión administrativa integral de tickets/anulaciones/reembolsos; liquidación mensual de vendedor; preferencias/canales externos de notificaciones; pruebas de integración/E2E en una base desechable; Capacitor y compilaciones móviles.

La ruta `/admin/prueba-completa` brinda un diagnóstico HTTP de solo lectura para servicios comunes y módulos permitidos a la sesión. Omite pruebas fuera de los roles/permisos efectivos y no sustituye una base de datos desechable ni las pruebas de concurrencia.

La ruta `/admin/datos-demo` consulta conteos agregados mediante `GET /api/admin/demo/status`, dentro del tenant y bajo `report.view`. Solo cuenta registros claramente identificables como DEMO; no expone PII/importes y no ejecuta seeds ni reinicios desde navegador.
