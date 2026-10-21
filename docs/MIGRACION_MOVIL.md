# Preparación móvil con Capacitor

La app web compila a `dist/` y `capacitor.config.json` ya referencia esa carpeta. El identificador `com.imperiross.app` es provisional: debe cambiarse por el identificador de paquete elegido por el propietario antes de publicar en tiendas.

## Preparar Android e iOS

Desde `C:\Imperio_Ross`, con acceso al registro npm, instala las dependencias oficiales de Capacitor 8:

```cmd
npm install @capacitor/core@^8
npm install --save-dev @capacitor/cli@^8 @capacitor/android@^8 @capacitor/ios@^8
npx cap add android
npx cap add ios
```

Compila y sincroniza el frontend antes de abrir el proyecto nativo:

```cmd
npm run build
npx cap sync
npx cap open android
```

En Windows se puede preparar y compilar Android con Node.js 22+, Android Studio y Android SDK. iOS requiere macOS y Xcode; desde una Mac, después de sincronizar, usa `npx cap open ios` para abrir el proyecto en Xcode.

## Reglas para la app

- La aplicación nativa comparte el frontend y consume la misma API; no tiene credenciales de PostgreSQL.
- El service worker web no se registra cuando Capacitor confirma que se ejecuta en plataforma nativa. Android/iOS usan el bundle local gestionado por Capacitor.
- La PWA web conserva la caché estática existente y no intercepta rutas `/api/`; operaciones financieras siempre necesitan respuesta del servidor.
- Cámara/QR, push y enlaces profundos necesitan sus plugins y configuración de permisos/proveedor antes de habilitarse. No se declaran activos en esta etapa.

La instalación de los paquetes y la creación/compilación de Android/iOS no pudieron ejecutarse en este entorno porque el registro `registry.npmjs.org` no resolvió DNS (`ENOTFOUND`). No se generaron APK, AAB ni IPA.
