# Reglas de negocio

- PostgreSQL decide saldo, precio, permisos, estado, cupo, cierre, ticket y pago.
- Importes en centavos enteros; jugadas como texto para conservar ceros iniciales.
- Apuesta diaria mínima 25 centavos y paso según `draw_modalities`; el servidor debe repetir validación.
- Compra se envía mediante `fn_submit_order` y clave de idempotencia; no se emite ticket activo por subir comprobante.
- Pago con billetera, revisión, reservas, emisión de tickets, premios, retiros y reembolsos usan funciones SQL atómicas ya definidas en el esquema.
- Rechazos/anulaciones conservan trazabilidad; no hay eliminación física de operaciones comerciales.
- Números Fortuna y rifas asignan números sin duplicados por restricciones en base.

La mayoría de los flujos API de compra/dinero aún están pendientes. No usar importes calculados en frontend como autoridad.
