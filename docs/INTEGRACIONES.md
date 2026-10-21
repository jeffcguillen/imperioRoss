# Integraciones

| Servicio | Estado | Requisito para activar |
|---|---|---|
| PostgreSQL | Conectado a la base local mediante roles separados y RLS por tenant | Mantener secretos solo en `.env`; operaciones de prueba financiera en base aislada |
| Correo/SMS | OTP mock para recuperación de compras solo en desarrollo local (`123456`); no entrega mensajes | Configurar proveedor SMS real, plantillas, secretos y pruebas antes de habilitar recuperación fuera de loopback |
| Comprobantes privados | Directorio local privado, MIME/tenant/permiso comprobados al servir | Para despliegue: volumen persistente y respaldo, o S3 compatible |
| Pasarela | Pendiente | Credenciales sandbox, firma de webhook y pruebas de conciliación |
| Notificaciones | Persistidas en PostgreSQL y visibles en la app | WhatsApp/push requiere proveedor, tokens y consentimiento |
| PWA | Manifest, instalación y shell offline estático; no almacena respuestas `/api` | Usar HTTPS en despliegue |
| Ejecución programada de jugadas | Implementada, desactivada por defecto | `SCHEDULED_PLAYS_ENABLED=true` más lista explícita `SCHEDULED_PLAYS_TENANT_IDS` |
| Capacitor | Configuración `capacitor.config.json` preparada; dependencias/plataformas no instaladas | Acceso a npm para instalar Capacitor; Android Studio/SDK o macOS/Xcode según plataforma |

El scheduler usa la función transaccional existente de PostgreSQL, excluye usuarios demo y procesa únicamente sesiones futuras próximas al cierre. Si la variable de activación está habilitada, la lista de tenants autorizados es obligatoria; sin ambas configuraciones permanece apagado. La programación demo existente nunca se procesa.

No hay botones o adaptadores que reporten pagos/envíos exitosos sin proveedor. La recuperación de cuenta responde 503 genérico hasta implementar entrega real. La recuperación de compras invitadas comparte el requisito de proveedor: el código `123456` solo funciona en desarrollo local y no se presenta como SMS enviado.
