# Roles y permisos

Roles del enum verificado en SQL: `admin`, `worker`, `seller`, `client`. Invitados no son usuarios autenticados; solo pueden recuperar sus compras propias al validar código de compra/ticket, teléfono y OTP de un solo uso.

La matriz editable reside en `app.role_permissions` y `app.fn_can(user, action)` consulta autorización. RLS aísla tenant, pero no sustituye los filtros de propiedad de recursos en la API.

## Módulos por tipo de cuenta

| Rol | Módulos visibles en navegación | Límites |
|---|---|---|
| `client` | Inicio personal, comprar, mis tickets, resultados, rifas especiales (si el tenant las habilita), billetera, jugadas programadas, favoritos y premios propios; además cuenta y notificaciones | Solo consulta sus registros. Compra, saldo, retiro y premios se validan en el servidor y por propietario/tenant. |
| `seller` | Inicio de vendedor, POS, contratas autorizadas, resultados, cuenta y notificaciones | POS/contratas requieren `sale.register`; ve ventas y comisiones propias. Sin módulos administrativos. |
| `worker` | Inicio de operaciones, POS si tiene `sale.register`, revisión de comprobantes si tiene `order.approve`, validación de premios si tiene `prize.validate`, resultados, cuenta y notificaciones | Además de la matriz, algunas operaciones requieren autorización individual del perfil y local asignado. |
| `admin` | Resumen, usuarios/permisos, búsqueda, configuración de tenant, agenda, planes de premio/versiones, auditoría, comisiones, finanzas/caja, reembolsos, rifas, recargas, resultados, retiros y operaciones de premios habilitadas; cuenta y notificaciones | El rol no omite los permisos individuales: cada módulo/acción revisa permiso y el backend/SQL vuelve a autorizar. |

## Revisión de visibilidad por rol y acciones — 20 de octubre de 2026

- La navegación se filtra por rol, permisos efectivos y módulos habilitados en `src/App.tsx`; los accesos directos a módulos internos sin autorización muestran una pantalla restringida. `RequireSession` protege las rutas internas y la API vuelve a validar sesión, rol, permiso, tenant y propiedad del registro.
- Cliente: compra, historial/repetición revisada, resultados, billetera/recargas, rifas habilitadas, jugadas programadas, favoritos, premios, cuenta y notificaciones. La repetición crea solo un borrador del carrito.
- Trabajador: POS, revisión de pagos y validación/pago de premios únicamente cuando posee el permiso correspondiente, autorización de perfil y local requerido; cuenta y notificaciones. Las anulaciones se limitan a ventas propias y a la ventana configurada.
- Vendedor: POS, Contratas autorizadas, panel de actividad/ventas/comisiones propias, cuenta y notificaciones. No tiene navegación ni rutas administrativas.
- Administración: herramientas operativas y financieras condicionadas individualmente a permisos; la página de comisiones requiere `commission.manage` y `finance.manage` tanto en la navegación como en el servidor.
- El inicio y el menú usan el mismo catálogo para presentar accesos directos a todos los módulos autorizados. El menú está disponible desde escritorio y móvil; el inicio no muestra un conteo genérico de módulos.
- Comisiones: ya se pueden crear, editar/publicar con motivo auditado, retirar y reactivar con motivo. “Retirar” es baja lógica para conservar relaciones y auditoría; las comisiones históricas calculadas no se recalculan. El servidor impide reactivar reglas con alcance/periodo duplicado.
- La matriz de código y rutas no sustituye una sesión E2E con cada cuenta: falta QA de navegador y validación con PostgreSQL aislado para certificar que la UI, RLS y datos coinciden en ejecución.

El login (`/acceso`) es la ruta inicial y toda ruta interna exige sesión. Al intentar abrir una ruta interna sin sesión se redirige a `/acceso`; tras autenticarse, el sistema vuelve a la ruta solicitada. `/verificar/:codigo` queda como excepción pública para validar un ticket por código y no expone información personal. La UI filtra módulos por rol, permiso y bandera del tenant; esto complementa, nunca sustituye, la autorización de API/PostgreSQL.

| Operación | Regla actual |
|---|---|
| Consultar cuenta/tickets/billetera/notificaciones | Sesión autenticada; API filtra por `actor.id` |
| Recuperar compra de invitado | Público, pero exige código + teléfono y OTP; la función SQL limita la consulta al tenant y a órdenes sin `user_id`; no devuelve contactos personales. OTP mock solo en desarrollo local hasta configurar proveedor SMS. |
| Editar sus propios datos de perfil | Cualquier cuenta autenticada; la API fija usuario/tenant desde la sesión, valida contacto único y no permite cambiar rol o local |
| Cambiar su contraseña | Cualquier cuenta autenticada; requiere la contraseña actual, invalida sesiones existentes y emite una cookie nueva |
| Consultar/guardar/eliminar números favoritos | Solo `client`; toda lectura y cambio filtra por usuario y tenant autenticados |
| Enviar compra directa | Cliente o invitado; servidor fija tenant/actor y llama la función SQL |
| Consultar cola de comprobantes | `order.approve`; API consulta mediante pool `ir_api_admin` |
| Aprobar/rechazar una orden | `order.approve` y además las restricciones de `fn_review_order`/`fn_reject_order`; operación atómica y auditada |
| Abrir un comprobante privado | `order.approve`; orden, pago, comprobante y tenant deben coincidir |
| Consultar/publicar/corregir resultados | Solo `admin` y permiso `result.edit`; la API usa `fn_register_result` y motivo para corrección |
| Solicitar recarga | Cliente autenticado; solo crea solicitud y comprobante pendientes |
| Aprobar/rechazar recarga | Solo `admin` con `recharge.approve`; función SQL transaccional |
| Anular tickets | Administración; trabajador solo sus ventas dentro de ventana permitida |
| Anular ticket desde búsqueda global | Solo admin con `report.view` para ubicarlo y `ticket.void` para anular; exige motivo, bloquea el ticket y llama `fn_void_ticket` auditado. El efecto es `none`: no crea reembolso automático. |
| Anular venta propia desde el POS | Solo worker con `ticket.void_own`; exige motivo, la orden debe tener su `worker_id`, y la función SQL verifica ventana, cierre del sorteo y que no existan premios pagados/en trámite. Vendedores no pueden anular desde esta función; no se crea reembolso automático. |
| Cobrar/pagar premios | Permiso específico y funciones SQL auditadas |
| Consultar dashboard | `admin` más `report.view`; los demás roles reciben 403 |
| Buscar/activar cuentas | Solo `admin`; al desactivar se revocan todas las sesiones del usuario y se guarda motivo en auditoría |
| Editar permisos de worker/seller | Solo `admin`; cambios por permiso y alcance guardan motivo y auditoría. No se pueden elevar permisos reservados a administración |
| Editar permisos individuales de personal | Solo `admin`; `can_pay_prizes`, revisión hasta cierre y ventana de anulación quedan registrados en auditoría |
| Crear trabajador/vendedor | Solo `admin`; exige clave inicial de 12+ caracteres, local activo y motivo. La clave se hashea; no se entrega al cliente en la respuesta |
| Cambiar rol de personal | Solo `admin`; puede cambiar una cuenta activa entre `worker` y `seller` si tiene local activo. El cambio exige motivo, se audita y no permite convertir cuentas de cliente/admin |
| Ver premios propios | Sesión autenticada con filtro por dueño de la orden |
| Validar premio | Admin o worker con `prize.validate`; para worker también requiere `staff_profiles.can_pay_prizes` |
| Pagar premio | `prize.pay`; worker debe contar con autorización individual y usar su local asignado. La función SQL evita pagos duplicados |
| Gestionar retiros | Solo admin con `withdrawal.manage`; worker/seller/client reciben 403 |
| Editar marca y configuración del tenant | Solo admin con `tenant.manage`; el tenant se obtiene del host validado, se exige motivo y revisión optimista, y la API registra auditoría explícita |
| Crear/activar planes y publicar una nueva versión de premios | Solo admin con `plan.edit`; valida tenant, modalidad habilitada y cantidad/orden exactos de suertes. La versión se agrega por `fn_new_plan_version`, sin editar las versiones anteriores. |
| Solicitar y resolver reembolsos | Solo admin con `refund.manage`; la solicitud por compra valida importe restante y queda pendiente/auditada. Los reembolsos a billetera usan `fn_complete_refund`. Una devolución externa se registra después de hacerla manualmente, con método y referencia, y necesita una cuenta de egresos activa. |
| Consultar/cobrar crédito de Contratas | Solo admin con `finance.manage`; cada abono parcial se valida contra el saldo pendiente y se registra con función SQL auditada |

Los logins de runtime `ir_api_staff` y `ir_api_admin` son diferentes, no superusuario y no tienen `BYPASSRLS`. La UI oculta el enlace administrativo según el rol de sesión, pero todas las rutas vuelven a validar permisos en el servidor y en PostgreSQL.

Hay cuatro cuentas locales `is_demo=true`, una para `admin`, `worker`, `seller` y `client`. Sus contraseñas aleatorias se guardan en `.local/demo-usuarios.txt`, excluido del repositorio. Un invitado no tiene cuenta: compra como anónimo y no accede a datos privados. El seed solo acepta `NODE_ENV=development` y localhost.

La gestión de usuarios/permisos, dashboard, premios/retiros, revisión, POS, sorteos, Contratas, finanzas y cobranza está conectada. La recuperación de cuenta aún requiere proveedor real de correo/SMS.
