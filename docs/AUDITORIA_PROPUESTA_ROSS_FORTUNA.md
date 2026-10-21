# Auditoría funcional de la propuesta Ross Fortuna v5.0

Fecha: 20 de octubre de 2026  
Fuente: `Ross_Fortuna_Propuesta_Detalle_actualizada_Jef.docx`, versión 5.0, 23 de septiembre de 2026.

## Cómo interpretar el documento

La propuesta define siete fases y sus reglas funcionales. El propio documento indica que el contrato prevalece, que Proyecto Original v2 detalla alcance y que sus elecciones técnicas son propuestas. La sección 15 enumera elementos opcionales/excluidos. Esta auditoría coteja el estado del código y el SQL del repositorio; una pantalla o prueba unitaria por sí sola no acredita la operación completa en la base real. No se interpreta el texto del Word como una autorización para alterar datos de producción.

Estados: **Parcial** indica que existe una parte sustancial pero queda una brecha; **Pendiente** indica que no hay implementación verificable; **Bloqueado por entorno** requiere servicios/toolchain ajenos al repositorio. “Verificado en código” no equivale a aceptación operativa.

## Resumen por fase

| Fase | Estado | Implementado y evidencia | Brechas para completar/aceptar |
|---|---|---|---|
| 1. Sorteos, compra, resultados y tickets | Parcial | Configuración de sorteos, modalidades y sesiones (`src/features/admin/AdminSchedulePage.tsx`, `server/routes/admin-schedule.ts`); planes/versiones (`src/features/admin/AdminPlansPage.tsx`, `server/routes/admin-plans.ts`); compra y validaciones servidor (`src/features/orders/BuyPage.tsx`, `server/routes/orders.ts`); consulta pública limitada del ticket. | No se encontró MFA/2FA para admin/caja. No está completo el enlace de compras invitadas a una cuenta verificada. Aprobación posterior al cierre no tiene evidencia de segundo aprobador independiente. Correcciones/versionado de resultados y recálculo de todos los premios deben integrarse y probarse contra PostgreSQL aislado. Falta E2E de compra, cierre, sorteo de resultado y pago de premio. |
| 2. Billetera, recargas y recurrencia | Parcial | Billetera/recargas y registro contable, favoritos y compra manual conectada; se añadió “Repetir jugada” al historial del cliente. GET `/api/tickets/:ticketId/repeat` limita tenant, propietario y líneas activas; carga al carrito y exige revisión antes del envío (`server/routes/repeat-plays.ts`, `src/features/orders/BuyPage.tsx`). | Canales de notificación externos no están configurados. Proveedores de pago son opcionales/excluidos según la propuesta y requieren credenciales. La repetición se probó a nivel de ruta, aún falta recorrido con BD aislada y UI real. Invitados no tienen billetera persistente, coherente con la propuesta. |
| 3. Premios, cobro y retiros | Parcial; brecha crítica de seguridad | SQL contempla vigencia configurable de premios y estructuras de códigos de cobro (`database/imperio_de_ross_completo.sql`); API de premios confirma pagos (`server/routes/prizes.ts`). | El código de cobro secreto no está integrado de extremo a extremo: la ruta de confirmación valida ticket y datos del pago, no exige el código secreto. La función SQL de creación depende de `app.claim_key`, pero no se encontró provisión/configuración del secreto en `server/env.ts`. Debe añadirse manejo de clave, acceso solo a personal autorizado, validación transaccional de código/expiración y protección contra doble pago antes de aceptar esta fase. Revisar también snapshot histórico de plazo por premio y el flujo completo de reserva/retiro/reembolso. |
| 4. Vendedores, comisiones y Contratas | Parcial | Panel de vendedor, contratos/reservas y planes de comisión por vendedor/sorteo/modalidad (`src/features/seller/SellerDashboardPage.tsx`, `src/features/contracts/ContractsPage.tsx`, `src/features/admin/AdminCommissionPlansPage.tsx`, `server/routes/admin-commissions.ts`). El admin tiene accesos visibles a roles/permisos y comisiones. Reglas requieren permisos efectivos del servidor. | Debe verificarse liquidación/pago de comisiones, cálculo de utilidad mensual, vínculo exclusivo a ventas personales y conciliación financiera en datos de prueba. Scheduler de jugadas programadas está apagado por defecto y necesita `SCHEDULED_PLAYS_ENABLED=true` más lista explícita de tenants (`server/env.ts`, `server/index.ts`). Falta recorrido E2E para cambios, pausa, reanudación, ejecución y fallos sin sustituir plan. |
| 5. Rifas especiales y Números Fortuna | Parcial | Administración/compra de rifas, selección/venta y vista pública de progreso (`src/features/admin/AdminRafflesPage.tsx`, `server/routes/raffles.ts`, `server/routes/admin-raffles.ts`); escrituras transaccionales. | La API actual de compra especial exige cliente autenticado; no se encontró compra de invitado para esta modalidad. Notificaciones externas y garantía concurrente se deben verificar en una base aislada con solicitudes concurrentes. |
| 6. Caja, finanzas e informes | Parcial | Panel de finanzas, cierres/cortes, cuentas y cuentas por cobrar (`src/features/admin/AdminFinancePage.tsx`, `src/features/admin/ReceivablesPanel.tsx`, `server/routes/admin-finance.ts`). Hay flujos de reembolso separado y anulación auditada. | La propuesta pide informes amplios (rifas especiales, ventas, comisiones, invitados, anulaciones, aprobaciones post-cierre y más). No se verificó un catálogo completo de reportes que cubra todos esos cortes ni submayor separado para sorteos diarios y especiales. Falta conciliar con datos representativos y probar cierre con diferencias. |
| 7. Android/iOS y publicación | Pendiente / bloqueado por toolchain | Existe configuración Capacitor (`capacitor.config.json`). | No hay proyectos Android/iOS compilados ni evidencia de publicación, push nativo, pruebas móviles o validación de paneles nativos. Requiere SDK/toolchain y cuentas de publicación. |

## Verificaciones transversales pendientes

- Aislamiento RLS/tenant y concurrencia con una base de integración desechable; no ejecutar pruebas de carrera sobre datos reales.
- MFA, almacenamiento/provisión de secretos de códigos de premio y entrega real de OTP/notificaciones.
- Recorridos E2E por rol: admin, trabajador, vendedor, cliente e invitado; incluyendo rutas directas no autorizadas, cierre de sesión y expiración de sesión.
- Accesibilidad, QA visual responsive y pruebas móviles reales.
- Respaldo y restauración comprobados, configuración de producción, monitoreo y conciliación.

## Acciones por rol y cambios de comisión

La tabla de módulos y reglas de acceso está en `docs/ROLES_Y_PERMISOS.md`. En la actualización del 20 de octubre se cotejaron la navegación de `src/App.tsx`, guardas de sesión/permisos y rutas API disponibles. Esa verificación de código confirma que la visibilidad está filtrada por rol/permisos y que la API vuelve a autorizar; no certifica todos los recorridos de navegador/BD.

La pantalla de comisiones ya permite crear una regla, editar y publicar cambios con motivo auditable, retirar una regla (baja lógica) y reactivarla cuando no choque con otra regla vigente. El servidor limita la gestión a admin con ambos permisos y al tenant actual. La eliminación física se evita porque borraría trazabilidad y puede romper referencias a comisiones históricas; las liquidaciones ya generadas conservan sus importes. Se requieren pruebas de navegador y de integración contra una base aislada.

## Próximos pasos recomendados

1. Corregir primero el ciclo de vida del código secreto de premio y su validación transaccional antes de liquidar premios.
2. Preparar PostgreSQL desechable desde el SQL/migraciones; probar RLS y los flujos de compra, cierre, resultados, comisiones, rifas y reembolsos.
3. Habilitar y probar scheduler solo con tenant explícito de integración; documentar controles operativos para producción.
4. Completar compra invitada de rifa especial, liquidación de comisiones y matriz de reportes exigida.
5. Generar apps nativas y realizar QA/publicación cuando SDK y cuentas estén disponibles.

## Cambio de repetición de jugada

El historial de tickets activos muestra “Repetir jugada”. La API solo devuelve detalles activos de tickets pertenecientes al cliente autenticado en el tenant actual. Al copiar al carrito se mantienen importe, número y plan cuando aún está vigente; si el plan cambió o hay varias opciones, se requiere elegir explícitamente. Si la sesión/modalidad ya no está disponible, esa línea se informa y se omite. La acción no compra ni cobra automáticamente. TypeScript de cliente/servidor, build Vite y 119 pruebas en 21 archivos pasaron. Las pruebas de ruta cubren sesión, rol, propiedad y líneas activas; aún falta una prueba de navegador y una BD de integración para validar consulta, RLS e historial con datos existentes.
