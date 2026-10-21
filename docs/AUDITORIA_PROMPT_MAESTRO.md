# Auditoría del prompt maestro y fases

Fecha de revisión: 20 de octubre de 2026. Alcance: prompts de integración completa, Fase 1, y actualización de diseño compartidos en esta conversación; código y documentación presentes en `C:\Imperio_Ross`.

## Criterio de estados

- **Completo (verificado):** existe implementación y se ejecutaron las comprobaciones indicadas.
- **Parcial:** hay una parte funcional, pero falta una capacidad exigida o una prueba de extremo a extremo.
- **Pendiente:** no se encontró implementación suficiente.
- **Bloqueado por proveedor/entorno:** el código puede prepararse, pero requiere credenciales, servicios o toolchain no disponibles.

La presencia de una pantalla o ruta no se considera prueba de funcionamiento integral.

## Auditoría de los 38 apartados del prompt maestro

| Apartado | Estado | Evidencia / brecha |
|---|---|---|
| 1. Objetivo integral web, PWA, móvil y multitenant | Parcial | Web, API, PostgreSQL y PWA existen; Android/iOS nativos aún no se compilan. |
| 2. Rutas oficiales del proyecto | Completo | La raíz es `C:\Imperio_Ross`; el SQL de referencia está en la raíz, no en `database/`. |
| 3. Reglas de ejecución e integridad | Completo en los bloques revisados | El SQL base no se reejecutó; se usan migraciones incrementales y no se probaron operaciones financieras reales. Revalidar esto en cada módulo futuro. |
| 4. Tecnologías y arquitectura | Parcial | React/TS/Vite, Fastify, PostgreSQL, React Router, TanStack Query y Vitest. Frontend y API ya usan `/api/v1`, con alias `/api` compatible, más documento OpenAPI 3.1 en desarrollo. El servidor conserva Fastify en vez de NestJS; tampoco hay Playwright, Tailwind, shadcn/ui ni Framer Motion. La UI Swagger y DTOs OpenAPI detallados faltan. |
| 5. Inspección y plan técnico | Completo | Existe `docs/PLAN_IMPLEMENTACION.md`, pero necesita sincronizarse con la auditoría presente. |
| 6. PostgreSQL, RLS y funciones | Parcial | Pools separados, contexto RLS y funciones SQL se usan. Falta demostrar aislamiento multitenant y concurrencia en una BD de prueba desechable; no se deben usar filas financieras locales para pruebas. |
| 7. Reglas de negocio | Parcial | Compra, dinero en centavos, números como texto, resultados y estados usan controles del servidor/SQL. La cobertura integral de cierres, reembolsos, concurrencia y casos combinados aún no está demostrada. |
| 8. Módulos y rutas | Parcial | Ver matriz de módulos debajo. La configuración del tenant y los locales cubren dominio y activación; siguen abiertas otras brechas operativas y de integración. La recuperación de invitado usa OTP mock local. |
| 9. Sincronización entre módulos | Parcial | TanStack Query e invalidaciones tras mutaciones están presentes en módulos. No se encontró estrategia común de eventos/polling para todas las colas y contadores. |
| 10. Seguridad y pasarela | Parcial/bloqueado | Sesiones, validación, rate limit, CORS, encabezados, almacenamiento privado y autorización servidor existen. No hay proveedor/webhook/conciliación de pasarela; 2FA y entrega externa de OTP tampoco están configurados. |
| 11. Dinero, concurrencia e idempotencia | Parcial | Importes se transportan en centavos y se invocan funciones transaccionales/idempotentes. Faltan pruebas de concurrencia y recorridos completos con DB aislada. |
| 12. Modelo de sorteos | Parcial | CRUD de sorteos, días, horarios, referencias, modalidades y cupos con `draw.create`; configuración de planes y versiones inmutables por `fn_new_plan_version` con `plan.edit`. No hay aún integración contra PostgreSQL desechable ni se validaron cambios históricos de extremo a extremo. |
| 13. Inicio y experiencia cliente | Parcial | Portada y navegación responsive consultan sesiones reales; contrastar detalles visuales requeridos (tres tarjetas, cuenta regresiva sincronizada, saldo ocultable, accesos) con el prompt de diseño y completar las diferencias. |
| 14. Compra, carrito y confirmación | Parcial | Compra conectada, borrador local, validación del servidor, comprobante e idempotencia. No representa el flujo como las cuatro pantallas descritas; revisar que favoritos/repetición siempre requieran revisión explícita. |
| 15. Pagos y comprobantes | Parcial/bloqueado | Transferencia y revisión de comprobantes están conectadas. Pasarela y webhook firmado están pendientes de proveedor y sandbox; conciliación automática no está acreditada. |
| 16. Billetera | Completo parcialmente verificado | Consulta de saldo/libro y recarga pendiente/aprobación están conectadas; se corrigió el nombre de columnas de `v_wallet_statement` y el GET se comprobó con sesión de cliente. El proveedor de pagos no está configurado. |
| 17. Tickets | Parcial | Tickets propios, verificación pública y recuperación de compra de invitado por código+teléfono+OTP están presentes. Tras OTP se muestra el código privado del premio solo para tickets ganadores. El OTP `123456` está limitado al desarrollo local; entrega SMS productiva pendiente. |
| 18. Resultados, planes y premios | Parcial; cobro protegido en PostgreSQL local | Migración 0006 aplicada: códigos cifrados recuperables por comprador, invitado verificado o admin autorizado; cobro SQL comprueba código dentro de la transacción, limita intentos, aplica expiración y evita pago duplicado. UI cliente/caja conectada y API con `no-store`. Falta configuración de clave en producción, E2E por rol y pruebas aisladas de premio acumulativo y conciliación. |
| 19. Retiros y reembolsos | Parcial | `/admin/reembolsos` permite solicitar una devolución parcial/total por código de compra y resolver pendientes; billetera se acredita por SQL. Pagos externos requieren devolución manual previa, método y referencia. No se inicia transferencia bancaria real ni hay proveedor externo. |
| 20. Administración | Parcial | Usuarios/permisos, locales, dashboard, agenda, sorteos, planes, revisión, rifas, finanzas, auditoría, búsqueda global, marca y cola de reembolsos están implementados. Anulaciones admin/worker respetan permisos; quedan automatizaciones financieras externas. |
| 21. Punto de venta | Completo parcialmente verificado | Venta de mostrador y consulta propia verificadas con sesión DEMO; queda pendiente el recorrido del formulario UI y cierres en una base aislada. |
| 22. Vendedores y comisiones | Completo parcialmente verificado | `/vendedor` carga ventas, comisiones y Contratas propias; plan del 10% DEMO generó comisión sobre una venta de 25 centavos. Liquidación mensual y pago siguen pendientes de recorrido aislado. |
| 23. Contratas | Completo parcialmente verificado | Asignación, venta de cupo y cobranza están implementadas; falta recorrido completo en DB aislada y validación de concurrencia. |
| 24. Jugadas programadas y favoritos | Parcial | Programación, scheduler opt-in y CRUD de favoritos existen. Cada favorito se puede cargar en Comprar como borrador para revisión explícita. Scheduler sigue apagado hasta allowlist y activación deliberadas. |
| 25. Rifas especiales y Números Fortuna | Completo parcialmente verificado | Administración, compras con billetera/transferencia, aprobación y revelación están conectadas. Faltan pruebas aisladas para asignación concurrente y cierre completo. |
| 26. Finanzas, contabilidad y caja | Parcial | Reportes, transferencias, vista previa/cierre y cuentas por cobrar están implementados. Conciliación de pasarela, búsqueda global y pruebas de cierre en DB aislada pendientes. |
| 27. Notificaciones | Parcial/bloqueado | Centro persistido y marcado como leído. Preferencias, push, WhatsApp, correo y notificaciones operativas externas requieren implementación/proveedores. |
| 28. PWA y app móvil | Parcial/bloqueado | PWA y configuración Capacitor están preparadas. Dependencias Capacitor no instaladas por `ENOTFOUND` al registro npm; no hay proyectos nativos ni APK/AAB/IPA. |
| 29. Datos demo | Parcial | Seeds idempotentes y `/admin/datos-demo` registran roles, compras/tickets/premio, vendedor/comisión, Contratas/cupos, rifa/paquete/Números Fortuna, cuentas contables, notificación y un retiro pendiente vinculado a un premio DEMO. Siguen faltando comprobantes, compras DEMO de rifa, recargas, cierres y otros estados de transacción; recorrido guiado y reinicio aislado pendientes. |
| 30. Estados y transiciones | Parcial | Funciones SQL controlan varias transiciones y existe `StatusBadge`; falta comprobar catálogo compartido y cobertura de transiciones para todos los dominios. |
| 31. Componentes reutilizables | Parcial | `PageHeading`, `EmptyState`, `FormError`, `StatusBadge` y otros se reutilizan. No se verificó equivalencia de todos los componentes sugeridos; no crear cascarones vacíos. |
| 32. Pruebas | Parcial | Última verificación local: 113 pruebas/20 archivos, TypeScript API/frontend y build Vite pasan. Siguen pendientes integración PostgreSQL aislada, RLS multitenant, concurrencia y Playwright/E2E para recorridos A–F. El chunk de entrada quedó en 475.53 kB y `vendor-react` en 436.41 kB. |
| 33. Configuración y arranque | Parcial | Scripts, `.env.example` y documentación Windows existen. Capacitor pendiente; revisar reproducibilidad limpia y documentar/validar copias de seguridad y restauración. |
| 34. Documentación | Parcial | Los documentos requeridos existen y se corrigieron las afirmaciones obsoletas sobre scheduler/admin. Mantener la auditoría sincronizada con cada módulo y revisar copias de seguridad/restauración. |
| 35. Fases | En curso | La implementación avanzó más allá del esqueleto, pero no debe declararse cerrada hasta cubrir los puntos marcados parcial/pendiente y ejecutar recorridos críticos. |
| 36. Módulos opcionales | Pendiente (no prioritario) | Promociones/cupones, ganadores públicos y otros opcionales no se encontraron completos. Priorizar módulos principales. |
| 37. Criterios de término | No cumplido todavía | UI Swagger y DTOs OpenAPI detallados, integraciones externas, móvil nativo, recorrido UI completo, ausencia de rutas críticas vacías y pruebas RLS/concurrencia aisladas aún tienen brechas. |
| 38. Ejecución autónoma y entrega veraz | En curso | Continuar por los pendientes y actualizar este documento y `PROGRESO.md` en cada bloque; no presentar el sistema como terminado. |

## Matriz de módulos principales

| Dominio del prompt | Estado real revisado | Pendiente concreto |
|---|---|---|
| Autenticación, roles y logout | Parcial | Perfil editable y cambio de contraseña ya están implementados con validación, unicidad, bcrypt, auditoría SQL y revocación de sesiones; recovery responde 503 hasta tener proveedor, y verificación de contacto y 2FA siguen pendientes. |
| Tenant y sucursales | Parcial | Consola `tenant.manage` configura dominio único, marca y módulo de rifas con auditoría. La gestión admin lista/crea/edita locales y activa/desactiva con motivo; la desactivación bloquea si hay personal activo asignado. Activación del tenant y prueba PostgreSQL integrada siguen pendientes. |
| Sorteos y planes | Parcial | CRUD de sorteo/horario/cierre/referencia/modalidad/cupo y editor admin de planes/versiones conectado a PostgreSQL. Versiones nuevas conservan premios históricos mediante `fn_new_plan_version`; faltan pruebas con DB aislada y validar la UX/flujo contra datos locales. |
| Compra, transferencia y tickets | Parcial | Flujo normal cliente/guest, comprobante, ticket aprobable y recuperación de invitado con OTP local existen; entrega SMS productiva y revisión E2E siguen pendientes. |
| Pasarela y reembolsos | Parcial/bloqueado por proveedor | Admin puede crear solicitudes de devolución por compra; la cola las resuelve con SQL auditado y referencia manual. No hay proveedor, webhook ni transferencia externa automatizada. |
| Billetera, premios y retiros | Parcial | Rutas y funciones existentes; pruebas integrales financieras pendientes. |
| Admin, auditoría y reportes | Parcial | Paneles reales, búsqueda global, gestión de locales, sorteos, planes y reembolsos con permisos específicos. Admin anula tickets desde búsqueda; worker anula ventas propias desde POS con `ticket.void_own` y límites SQL. |
| POS, vendedor, contratas, comisiones | Completo parcialmente verificado | Se validaron por login real las rutas seller para ventas, comisiones y Contratas; el administrador configura planes, asigna `worker`/`seller`, usuarios y permisos. Se corrigió una consulta SQL que impedía leer Ventas. Accesos directos añadidos al inicio admin. Aún falta la prueba de extremo a extremo del formulario de venta, la liquidación y el pago de comisiones en DB aislada. |
| Jugadas programadas y favoritos | Parcial | API y UI; favoritos precargan número/modalidad en Comprar como borrador revisable. Scheduler opt-in apagado sin configuración explícita. |
| Rifas y Números Fortuna | Parcial | Flujos conectados a SQL; falta integración concurrente y escenarios completos de cierre. |
| Finanzas y caja | Parcial | Consultas/cierre/transferencia/cobranza presentes; conciliación y pruebas críticas aisladas faltan. |
| Notificaciones | Parcial | Bandeja interna; preferencias y canales externos sin proveedor. |
| Web, PWA y móvil | Parcial | Build web verificado; PWA verificada previamente; Capacitor no instalado ni compilado. |

## Revisión de acceso inicial y módulos por rol — 20 de octubre de 2026

- Se confirmó la matriz `admin`, `worker`, `seller` y `client` en `docs/ROLES_Y_PERMISOS.md`, cotejándola con el enum SQL, las acciones declaradas en `src/App.tsx` y las rutas protegidas de `server/routes/`.
- `/acceso` es la pantalla de inicio de sesión; las rutas internas requieren `/api/auth/me` válido y conservan el destino solicitado para volver tras el login. Registro/recuperación continúan como rutas públicas de autenticación; `/verificar/:codigo` es la excepción pública de verificación que solo expone datos del ticket, no del comprador.
- El menú y el inicio se separan por rol y permisos. Se comprueba además el acceso directo al módulo en el cliente y las mutaciones/lecturas vuelven a validarse en la API y PostgreSQL. No confundir este guard visual con autorización suficiente.
- El inicio del cliente muestra billetera y compra; trabajadores/vendedores reciben herramientas operativas permitidas, y administración accesos de gestión. Los sorteos enlazan a compra para clientes, agenda para administradores autorizados y POS para personal autorizado.
- Las brechas funcionales continúan: anulaciones administrativas integrales, entrega de OTP por proveedor, canales externos y pruebas de integración/E2E con PostgreSQL desechable. Esta revisión no declara terminado el sistema.

## Accesos de administración para roles y comisiones — 20 de octubre de 2026

- El panel admin muestra accesos directos a usuarios/roles/permisos y comisiones; el menú los presenta con nombres explícitos.
- `/admin/usuarios` asigna `worker` o `seller` al crear personal y permite cambiar entre ambos para una cuenta activa con local vigente. Se protegen cuentas admin/cliente; cambios requieren motivo y auditoría. La matriz permite ajustar acciones y alcance por rol, más autorizaciones individuales del personal.
- `/admin/comisiones` crea planes por vendedor/sorteo/modalidad con porcentaje, monto fijo o utilidad mensual y puede desactivarlos. El servidor y PostgreSQL verifican ambos permisos de administración financiera.
- La consulta local de PostgreSQL confirmó `commission.manage=true` y `finance.manage=true` para el rol admin. Pruebas Fastify inject cubren el cambio autorizado y la protección de cuentas; TypeScript API/frontend y build Vite aprobados. No se cambió ningún rol de la base.

## Criterios de aceptación de Fase 1

| # | Criterio | Estado |
|---:|---|---|
| 1 | Todas las pantallas previstas | Parcial: hay rutas principales, recuperación de invitado local y algunas superficies/configuración por rol pendientes. |
| 2 | Navegación entre módulos | Completo en las rutas declaradas; no implica que cada dominio esté terminado. |
| 3 | Diseño responsive | Parcial: CSS responsive y navegación móvil; falta revisión visual sistemática en 360/768/1280/1536 y auditoría AA. |
| 4 | Validación y estados de formularios | Parcial: presentes en los flujos principales; falta inventario/QA pantalla por pantalla. |
| 5 | Layouts y menús diferenciados por rol | Parcial: filtro de menú, panel vendedor dedicado y autorización de servidor; las rutas deben someterse a prueba por cada rol. |
| 6 | Rutas/permisos preparados para auth real | Completo en las rutas actuales; cobertura integral de permisos y acceso directo aún pendiente. |
| 7 | Servicios desacoplados de UI | Parcial: cliente HTTP y módulos por feature; `App.tsx` todavía concentra pantallas/composición extensa. |
| 8 | Muestras aisladas y rotuladas | Parcial: demos/seed controlados; pantallas demo exigidas no se encontraron. |
| 9 | Sin botones críticos decorativos | Sin evidencia suficiente para certificar todas las pantallas; revisar interactivos y rutas. |
| 10 | Sin credenciales ni DB desde navegador | Cumplido por arquitectura inspeccionada; servidor usa PostgreSQL y secretos no se compilan en cliente. |
| 11 | Compila y sin errores críticos | Verificado en último bloque: TypeScript API/frontend y build Vite aprobados; no equivale a QA de todos los recorridos UI. |
| 12 | Preservar funcionalidades y documentar límites | Parcial: carpetas de referencia se conservan; actualizar contradicciones documentales y seguir esta matriz. |

## Verificación ejecutada en esta revisión — editor de planes, 20 de octubre de 2026

- Se integró `/admin/planes` al menú, guard de navegación y accesos rápidos del admin; la pantalla está diferida por carga dinámica.
- El editor requiere `admin` + `plan.edit`, tenant, modalidades activas y una entrada por cada suerte. La API crea planes, activa/desactiva y publica versiones nuevas usando la función SQL inmutable `app.fn_new_plan_version`; cada versión previa queda intacta.
- Typecheck de API, TypeScript del frontend, build Vite y Vitest pasaron: 100 pruebas en 19 archivos. El chunk de entrada quedó en 461.25 kB minificado y `vendor-react` en 436.41 kB.
- Se añadió al POS la anulación de tickets propios del trabajador: `ticket.void_own`, motivo obligatorio, coincidencia de `worker_id`, bloqueo de fila y validación final de horario/ventana/premios por `fn_void_ticket`. El efecto financiero no inicia un reembolso.
- Se añadió `/admin/reembolsos` bajo `refund.manage`. El listado está limitado al tenant; al completar se bloquean el reembolso y el pago, se verifica el total pendiente+completado frente al importe original y se llama a `fn_complete_refund`. Billetera acredita saldo; otros métodos exigen que el admin confirme una devolución ya realizada, guarde método/referencia en notas auditables y tenga una cuenta de egresos activa para registrar el asiento.
- No se ejecutó SQL contra la base local en esta revisión ni se pudo verificar el recorrido visual mediante navegador. La integración con PostgreSQL desechable sigue pendiente.

## Comparación con el prompt maestro de Downloads — 20 de octubre de 2026

Se comparó el archivo `C:\Users\Admin\Downloads\Prompt_Maestro_Imperio_de_Ross_FullStack_PostgreSQL.txt` con el repositorio, esquema SQL y rutas ejecutables. También se recibió y revisó `C:\Users\Admin\OneDrive - globalhiperautomation com\Documentos\RossFortune\Ross_Fortuna_Propuesta_Detalle_actualizada_Jef.docx`, versión 5.0 del 23 de septiembre de 2026. La propuesta declara que el contrato prevalece, el Proyecto Original v2 detalla el alcance y las decisiones técnicas del documento son propuestas; su sección 15 excluye funcionalidades opcionales. La comparación funcional por sus siete fases queda en `docs/AUDITORIA_PROPUESTA_ROSS_FORTUNA.md`.

- Se agregó compatibilidad REST `/api/v1`; el cliente web ya prefija sus llamadas por esa versión y las rutas legacy `/api` siguen disponibles.
- La consulta de billetera se corrigió para usar `amount_cents`, `balance_before_cents` y `balance_after_cents` de `v_wallet_statement`.
- Se agregó `database/scripts/seed-demo-raffle.mjs`: rifa abierta DEMO, paquete, dos Números Fortuna, cuentas de ingresos/egresos de ejemplo y notificación interna. No crea compra ni pago y valida entorno local/permisos.
- Por sesión cliente en `/api/v1` se verificaron billetera, tickets, premios, notificaciones y rifa; Administración leyó el inventario. Resumen actual del inventario: 4 usuarios DEMO, 2 órdenes, 1 comisión, 2 Contratas, 1 rifa; ambos logout respondieron 204.
- Se agregó prefijo `/api/v1` conservando los aliases `/api`; el cliente HTTP central usa v1. Se corrigió `/api/wallet` para leer los nombres reales de la vista y la verificación autenticada del cliente ya responde sin error.
- OpenAPI 3.1 se genera desde `docs/API.md` con `npm run docs:openapi` y se entrega solo en desarrollo en `/api/v1/openapi.json`. La UI Swagger y los esquemas detallados de cuerpos/respuestas siguen pendientes.
- Inventario DEMO extendido para pagos, comprobantes, compras/paquetes de rifa, Números Fortuna, retiros, recargas, cuentas financieras y cierres. Hay 1 retiro pendiente asociado a un premio DEMO; comprobantes, recargas, compras de rifa y cierres siguen en cero. No se inventaron comprobantes ni cierres contables.
- `tsc --noEmit -p tsconfig.server.json`, `tsc -b` y `vite build` aprobados. API local, OpenAPI v1, billetera, tickets, premios, notificaciones, rifa pública e inventario admin respondieron; login cliente/admin y logout 204. El frontend local respondió 200. El recorrido visual UI y la base aislada RLS/concurrencia continúan pendientes.

## Recuperación de compras de invitado — 20 de octubre de 2026

- Se agregó `/recuperar-compra` como pantalla pública y se enlazó desde la consulta de tickets.
- La API liga OTP a tenant, teléfono normalizado y código de compra/ticket; la respuesta inicial es genérica, el hash queda HMAC, expira en 10 minutos y `fn_check_otp` controla intentos y consumo. La respuesta final solo contiene compra invitada sin datos de contacto.
- El OTP fijo `123456` solo se usa en desarrollo de loopback y tests. Producción requiere proveedor SMS; no se simula entrega.
- TypeScript API/frontend, 113 pruebas en 20 archivos y build Vite pasaron (chunk principal 475.53 kB). No se ejecutó contra PostgreSQL local ni se hizo QA de navegador; esos recorridos aún requieren verificar RLS y formato de teléfono con la BD real.

## Código privado y pago de premios — 20 de octubre de 2026

- `database/migrations/0006_prize_claim_security.sql` y correcciones 0007-0008 aplicadas con éxito en PostgreSQL local mediante `rf_dev`. Las migraciones agregan un rol `NOLOGIN` de alcance reducido, permisos mínimos para bloqueos de fila y lectura RLS del tenant, más una tabla RLS para intentos fallidos; el procesador SQL comprueba dueño del ticket, tenant, permiso de cobro, local activo, vigencia del premio y código de seis dígitos, bajo bloqueo transaccional. Cinco fallos bloquean ese ticket por 15 minutos; los pagos duplicados se rechazan.
- API y pantallas: cliente autenticado e invitado con OTP pueden consultar el código; personal autorizado lo introduce al pagar y el administrador puede consultar el respaldo con permiso específico. La respuesta de códigos y la recuperación de compra usan `private, no-store`.
- `CLAIM_CODE_KEY` se requiere en API, se agregó al `.env.example` y al backend Render; la clave local se guardó solo en `.env` ignorado. Producción debe provisionar su clave estable antes del despliegue.
- Pruebas SQL de rechazo y cobro válido pasaron en transacciones DEMO y terminaron con `ROLLBACK`; también pasaron consultas de código por comprador autenticado y admin autorizado. No se efectuó ni se conservó ningún pago.
- `tsc -b`, `vite build` y `tsc --noEmit -p tsconfig.server.json` pasaron. Vitest: 128 pruebas en 24 archivos aprobadas.

## Solicitud administrativa de reembolso — 20 de octubre de 2026

- `/admin/reembolsos` ahora permite crear una solicitud parcial/total por código de compra, motivo e importe decimal USD.
- La API exige `refund.manage`, bloquea el pago, reserva el total pendiente/completado, impide exceder el saldo reembolsable y crea un `refunds` pendiente auditado. La resolución sigue separada: billetera por función SQL o devolución externa manual con referencia.
- Nuevas pruebas cubren autorización, exceso de importe y creación pendiente sin liquidación anticipada. No se realizaron operaciones contra la base local.

## Dominio tenant y estado de locales — 20 de octubre de 2026

- La pantalla de marca edita un hostname DNS opcional, conserva el slug, valida formato/colisión y guarda el cambio auditado bajo `tenant.manage`.
- Usuarios y permisos lista locales activos e inactivos. Reactivación/desactivación exige motivo; se rechaza desactivar si hay personal activo asignado. Nuevas cuentas solo pueden asociarse a locales activos.
- Suite completa: 113 pruebas/20 archivos; typecheck API/frontend y build Vite pasan. No hubo conexión de navegador/API a la instalación local ni cambios de datos en PostgreSQL.

## Verificación ejecutada en revisión anterior

- Inspección estática de rutas frontend, rutas API, módulo de autenticación, documentos y los requisitos de los prompts compartidos.
- En esta revisión pasaron `tsc --noEmit -p tsconfig.server.json`, `tsc -b`, Vite production build y Vitest: 78 pruebas/17 archivos.
- Frontend `http://127.0.0.1:5173/` devolvió HTTP 200 y título esperado; API `/health/ready` respondió `ready`. El cliente DEMO completó login, lectura de sesiones/tickets/premios y logout; la cookie revocada ya no autentica. No fue posible inspección visual automatizada porque CUA está deshabilitado.
- PostgreSQL: se mantuvo el tenant configurado y se aplicó el fixture DEMO local aislado descrito en `PROGRESO.md`: sorteo con nombre NO OFICIAL, dos sesiones, plan, compra de 25 centavos usando billetera demo, un ticket y un premio. No se modificaron sorteos oficiales ni datos de cuentas reales.

## Orden de continuación

1. Cerrados en código: gestión de sucursales, editor de sorteos/planes, anulación de tickets propios, solicitud/resolución de reembolsos y recuperación de invitado con OTP local. Pendientes: devolución externa automatizada.
2. Crear estrategia de pruebas de integración en base desechable y cubrir permisos, RLS, concurrencia y recorridos críticos sin usar datos financieros locales.
3. Retomar pasarela, correo/OTP y móvil nativo cuando haya sandbox/credenciales, acceso a npm y toolchain disponible.
