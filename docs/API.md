# API HTTP

Base local: `http://127.0.0.1:3000/api/v1`. El cliente web usa las rutas versionadas; `/api/*` permanece como alias de compatibilidad. En desarrollo, `/api/v1/openapi.json` entrega el inventario OpenAPI 3.1 generado desde esta guía. Errores públicos en español. El navegador usa cookies HttpOnly `SameSite=Strict`; las mutaciones validan `Origin` y CORS permite los dos orígenes locales configurados. La UI Swagger y los esquemas DTO detallados siguen pendientes.

| Método | Ruta | Acceso | Estado |
|---|---|---|---|
| GET | `/health/live` | Público | Implementado |
| GET | `/health/ready` | Público | Verifica ambos pools |
| GET | `/api/openapi.json` | Desarrollo local | Especificación OpenAPI 3.1 generada desde esta guía; se publica como `/api/v1/openapi.json` |
| GET | `/api/tenant/config` | Público por host | Conectado a PostgreSQL |
| POST | `/api/auth/register` | Público, rate limit | Implementado |
| POST | `/api/auth/login` | Público, rate limit | Implementado |
| POST | `/api/auth/logout` | Sesión opcional | Implementado |
| GET | `/api/auth/me` | Sesión | Implementado |
| PATCH | `/api/auth/profile` | Dueño autenticado | Actualiza nombre/teléfono/correo; valida formato y unicidad por tenant, con auditoría SQL |
| POST | `/api/auth/password/change` | Sesión con contraseña actual | Hash bcrypt, revocación de sesiones existentes y nueva cookie; rate limit |
| POST | `/api/auth/recovery` | Público, rate limit | Pendiente de proveedor real de correo/SMS |
| GET | `/api/sessions/open` | Público por tenant | Conectado; sesiones reales |
| GET | `/api/results` | Público por tenant | Conectado |
| GET | `/api/raffles` | Público por tenant/módulo | Conectado |
| GET | `/api/payment-options` | Público por tenant | Conectado |
| POST | `/api/orders` | Invitado o cliente | Compra transaccional con idempotencia y comprobante privado |
| GET | `/api/tickets` | Dueño autenticado | Conectado; devuelve 401 sin sesión |
| GET | `/api/tickets/verify/:code` | Público, 20/min | Verifica ticket sin exponer datos del comprador |
| POST | `/api/guest-purchases/recovery/start` | Público, 4/15 min | Aceptación genérica; valida código+teléfono por tenant y emite OTP mock solo en desarrollo local |
| POST | `/api/guest-purchases/recovery/verify` | Público, 8/15 min | Consume OTP de un solo uso; solo devuelve compra de invitado después de verificar ambos datos |
| GET | `/api/wallet` | Dueño autenticado | Conectado |
| GET | `/api/wallet/recharges` | Cliente dueño | Historial propio de recargas y motivos de rechazo |
| POST | `/api/wallet/recharges` | Cliente dueño, multipart | Comprobante privado, idempotencia y saldo pendiente de aprobación |
| GET | `/api/notifications` | Dueño autenticado | Conectado |
| GET | `/api/favorites` | Cliente autenticado | Números favoritos de su propio usuario y tenant |
| POST | `/api/favorites` | Cliente autenticado | Guarda número de 2–4 cifras; conserva ceros iniciales y rechaza duplicados |
| DELETE | `/api/favorites/:id` | Cliente dueño | Elimina solo si el favorito pertenece al usuario y tenant autenticados |
| GET | `/api/pos/sales` | Trabajador/vendedor con `sale.register` | Historial propio; limita compras por vendedor o trabajador autenticado |
| POST | `/api/pos/orders` | Trabajador/vendedor con `sale.register` y local asignado | Venta de mostrador idempotente, emite ticket y genera comisión cuando aplica un plan activo |
| GET | `/api/pos/commissions` | Vendedor con `sale.register` | Comisiones propias; trabajadores y clientes reciben 403 |
| GET | `/api/tickets/:ticketId/repeat` | Cliente registrado, propietario del ticket | Devuelve solo las líneas activas de su propio ticket para cargarlas como nuevo borrador; no compra ni cobra |
| GET | `/api/contracts` | Vendedor con `sale.register` o admin con `report.view` | Contratas propias del vendedor; administración ve las del tenant |
| POST | `/api/contracts/slots/:slotId/sell` | Vendedor dueño de la Contrata | Convierte un cupo reservado en venta con idempotencia |
| GET | `/api/admin/orders/pending` | Sesión con `order.approve` | Cola real por pool admin |
| POST | `/api/admin/orders/:orderId/review` | Sesión con `order.approve` | Llama `fn_review_order` o `fn_reject_order` en transacción |
| GET | `/api/admin/orders/:orderId/proofs/:proofId` | Sesión con `order.approve` | Archivo privado, tenant/orden comprobados, sin caché |
| GET | `/api/admin/recharges/pending` | Admin con `recharge.approve` | Cola de transferencias a billetera |
| POST | `/api/admin/recharges/:rechargeId/review` | Admin con `recharge.approve` | Llama `fn_review_recharge`; aprueba/acredita o rechaza con motivo |
| GET | `/api/admin/recharges/:rechargeId/proofs/:proofId` | Admin con `recharge.approve` | Archivo privado ligado a recarga y tenant |
| GET | `/api/admin/results/sessions` | Admin con `result.edit` | Sesiones sorteadas y resultados vigentes para publicar/corregir |
| POST | `/api/admin/results` | Admin con `result.edit` | Publica mediante `fn_register_result`; versión, premios y auditoría atómicos |
| GET | `/api/admin/dashboard` | Admin con `report.view` | Métricas de hoy por zona horaria del tenant |
| GET | `/api/admin/demo/status` | Admin con `report.view` | Conteos agregados de registros identificables como DEMO en el tenant; no devuelve datos personales ni financieros |
| GET | `/api/admin/search?q=...` | Admin con `report.view` | Busca usuarios, compras y tickets del tenant; exige dos caracteres y devuelve hasta 40 resultados mínimos |
| GET | `/api/admin/users` | Admin | Búsqueda y paginación; excluye hashes, secretos y datos de sesión |
| GET | `/api/admin/locations` | Admin | Lista locales activos e inactivos del tenant; solo locales activos se ofrecen para asignación |
| POST | `/api/admin/locations` | Admin | Crea un local dentro del tenant y audita el motivo; nombre duplicado devuelve 409 |
| PATCH | `/api/admin/locations/:locationId` | Admin | Edita nombre/ciudad/dirección del local del tenant, con before/after y motivo auditados |
| PATCH | `/api/admin/locations/:locationId/status` | Admin | Activa/desactiva con motivo auditado; no permite desactivar mientras tenga personal activo asignado |
| GET | `/api/admin/tenant` | Admin con `tenant.manage` | Lee marca y configuración del tenant resuelto por el servidor |
| PATCH | `/api/admin/tenant` | Admin con `tenant.manage` | Actualiza dominio personalizado, branding, zona horaria, idioma, moneda y flag de rifas; exige dominio único, revisión vigente y motivo auditado |
| POST | `/api/admin/users` | Admin | Crea trabajador/vendedor con clave inicial hasheada, local y motivo auditado; permisos individuales parten desactivados |
| PATCH | `/api/admin/users/:userId/role` | Admin | Cambia personal activo entre trabajador/vendedor; exige local activo y motivo auditado; no cambia cuentas admin/cliente |
| GET | `/api/admin/roles/permissions` | Admin | Matriz configurable de trabajadores y vendedores |
| PATCH | `/api/admin/roles/permissions` | Admin | Actualiza permiso editable y agrega auditoría con motivo; acciones reservadas quedan protegidas |
| PATCH | `/api/admin/users/:userId/status` | Admin | Activa/desactiva y revoca sesiones al desactivar; motivo auditado |
| PATCH | `/api/admin/staff/:userId/permissions` | Admin | Ajusta permisos individuales de personal con motivo auditado |
| GET | `/api/admin/commission-plans` | Admin con `commission.manage` y `finance.manage` | Consulta planes, vendedores activos y sorteos habilitados |
| POST | `/api/admin/commission-plans` | Admin con `commission.manage` y `finance.manage` | Crea plan por vendedor/sorteo/modalidad; valida cruces de alcance y fechas |
| PATCH | `/api/admin/commission-plans/:id` | Admin con `commission.manage` y `finance.manage` | Edita/publica una regla activa con motivo auditado; no modifica importes de comisiones ya generadas |
| PATCH | `/api/admin/commission-plans/:id/active` | Admin con `commission.manage` y `finance.manage` | Activa/desactiva el plan con motivo auditado |
| GET | `/api/admin/contracts/options` | Admin con `finance.manage` | Consulta vendedores, sorteos, modalidades y planes disponibles para asignación |
| POST | `/api/admin/contracts` | Admin con `finance.manage` | Asigna Contrata a vendedor y materializa cupos sobre sesiones existentes |
| GET | `/api/prizes/mine` | Dueño autenticado | Premios de tickets propios solamente |
| GET | `/api/prizes/locations` | Admin o trabajador autorizado | Locales activos; trabajador limitado a su local |
| POST | `/api/prizes/validate` | Admin/trabajador autorizado | Valida sin pagar; usa la función auditada de PostgreSQL |
| POST | `/api/prizes/pay` | Admin/trabajador autorizado | Pago explícito, local comprobado y función SQL de pago único |
| POST | `/api/prizes/:prizeId/credit` | Dueño del premio autenticado | Transfiere premio al ledger por función SQL |
| POST | `/api/prizes/:prizeId/withdrawal` | Dueño del premio autenticado | Solicita retiro con clave idempotente |
| GET | `/api/admin/withdrawals` | Admin con `withdrawal.manage` | Cola de retiros activos |
| POST | `/api/admin/withdrawals/advance` | Admin con `withdrawal.manage` | Transición controlada por `fn_advance_withdrawal` |
| GET | `/api/admin/finance/receivables` | Admin con `finance.manage` | Saldos de crédito abiertos/parciales, abonos y trazabilidad por tenant |
| POST | `/api/admin/finance/receivables/:id/payments` | Admin con `finance.manage` | Abono total/parcial idempotente; valida saldo y llama `fn_receive_receivable_payment` |
| POST | `/api/admin/finance/refunds` | Admin con `refund.manage` | Crea solicitud pendiente por código de compra; bloquea el pago, valida monto restante y registra auditoría |
| GET | `/api/admin/finance/refunds` | Admin con `refund.manage` | Cola tenant-scoped de devoluciones pendientes |
| POST | `/api/admin/finance/refunds/:refundId/complete` | Admin con `refund.manage` | Acredita billetera por SQL o registra devolución externa ya realizada con método/referencia |

El registro acepta `fullName`, `phone`, email opcional, contraseña, `adultConfirmed: true` y `termsAccepted: true`. Login acepta `identifier` y contraseña. La API nunca acepta tenant, rol o ID de usuario del cuerpo para decidir la identidad.

Las rutas administrativas usan únicamente el pool `ir_api_admin`; las consultas generales usan `ir_api_staff`. PostgreSQL valida de nuevo el permiso con `app.fn_can`; las transiciones financieras se ejecutan mediante funciones SQL existentes. La cola administrativa exige sesión y permiso incluso si se navega directamente a la URL.

Las APIs disponibles incluyen POS, comisiones, contratas, rifas, finanzas, caja, auditoría, jugadas programadas y favoritos. El scheduler de jugadas está implementado pero apagado por defecto. Siguen pendientes proveedores externos y recorridos de integración/E2E en una base aislada.

## Revisión de pagos

La página `/admin/comprobantes` y las rutas `/api/admin/orders/*` ya están conectadas. La consulta de cola usa el pool admin; las decisiones se delegan a `fn_review_order` y `fn_reject_order`, que validan permisos, estado, cierres, saldos, auditoría y emisión de tickets. Los comprobantes se entregan desde almacenamiento privado mediante IDs ligados a la orden y al tenant.

La ruta sin sesión se comprobó con HTTP 401. No se ejecutó una aprobación o rechazo real porque cambiaría compras existentes; una cuenta de aplicación con `order.approve` es necesaria para validar ese recorrido.

## Verificación de tickets

`/verificar/:codigo` consulta `/api/tickets/verify/:code`, limitado por tasa y tenant. La respuesta muestra estado, sorteo, fecha, números e importes sin nombre, teléfono, correo ni método de pago del comprador. La página genera un QR PNG por ticket con su enlace canónico de verificación, muestra el logo del tenant y permite imprimir, descargar un PDF con el logo del sistema y QR incrustado, y compartir/copiar el enlace. El POS enlaza cada ticket a esta vista pública.

La ruta pública `/recuperar-compra` recibe el código de compra/ticket y teléfono, y luego consulta la compra tras verificar un OTP de un solo uso. La API devuelve la misma aceptación tanto si encuentra como si no encuentra la compra, liga el OTP al tenant, código y teléfono normalizado, limita intentos y no incluye datos de contacto en la respuesta. En `NODE_ENV=development` solo desde loopback, el OTP de demostración es `123456`; se almacena como HMAC, expira en 10 minutos y el frontend solo muestra esa ayuda cuando Vite corre en desarrollo. Fuera del modo local la ruta devuelve 503 hasta configurar entrega SMS real.

## Recargas de billetera

El cliente consulta únicamente su historial y envía monto en centavos, cuenta bancaria, UUID de idempotencia y comprobante JPG/PNG/PDF de hasta 5 MB. El servidor valida banco, método, rango de importe, MIME real, hash repetido y propietario de la billetera. `fn_request_recharge` crea la solicitud y pago en revisión; no modifica el saldo.

Administración ve la cola a través de `/api/admin/recharges/pending`. La aprobación/rechazo se limita al rol admin y `recharge.approve`, entrega el comprobante desde almacenamiento privado y ejecuta `fn_review_recharge`. La aprobación acredita mediante ledger y contabilidad en una transacción; el rechazo conserva motivo e instrucción para corregir.

## Publicación de resultados

La página `/admin/resultados` solo aparece para `admin`. El endpoint compara permiso declarativo y rol, limita la publicación al horario posterior al sorteo y vuelve a bloquear sesión/modalidad en PostgreSQL. `fn_register_result` conserva versiones, exige motivo al corregir, procesa premios y audita dentro de la transacción. Repetir los mismos números es idempotente en la API. La ruta se comprobó con 401 sin sesión y consulta autenticada; no se publicó ningún resultado porque no había sesiones elegibles.
