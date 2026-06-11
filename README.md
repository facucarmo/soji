# Soji 🐾

**El cuidado de tu mascota, simple.** PWA para registrar vacunas, desparasitaciones, visitas al veterinario y peso. Sin cuentas, sin publicidad, gratis — todo se guarda en el dispositivo.

**▶ App en vivo: https://facucarmo.github.io/soji/**

Para instalarla en el teléfono: abrir el link y "Agregar a pantalla de inicio" (iOS/Safari) o "Instalar app" (Android/Chrome).

## Funcionalidades

- **Multi-mascota** con perfil editable y foto
- **Registro** de vacunas (con refuerzo), desparasitaciones (con repetición), visitas al vet y peso
- **Alertas inteligentes**: "Lo que viene" muestra solo los vencimientos vigentes — al registrar un refuerzo, la alerta anterior se da por cubierta (el historial conserva todo)
- **Alertas accionables**: registrar la aplicación de hoy con un toque, o agregar el vencimiento al calendario del teléfono (.ics con aviso)
- **Notificaciones** opcionales al abrir la app (vencimientos ≤ 7 días)
- **Historial completo** con filtros, edición, borrado y agrupación por año
- **Gráfico de evolución del peso**
- **Respaldo**: exportar/restaurar todos los datos en JSON
- **Offline**: funciona sin conexión una vez visitada (service worker)
- Accesibilidad: contraste AA, navegación por teclado, lectores de pantalla

## Privacidad

Los datos no salen del dispositivo: viven en `localStorage`, no hay servidor, no hay cuentas, no hay analytics de terceros. El respaldo JSON es del usuario.

## Stack

HTML + CSS + JavaScript vanilla, sin dependencias ni build.

- `index.html` — toda la app (UI, estilos y lógica)
- `manifest.webmanifest` — manifest de la PWA
- `sw.js` — service worker (cache offline, app shell)
- `icons/` — íconos de la app

## Correr local

Necesita servirse por HTTP para que funcione el service worker:

```
npx http-server -p 8123 -c-1 .
```

Después abrir http://localhost:8123

## Deploy

GitHub Pages desde la rama `master`. Cada push a `master` publica automáticamente en ~1 minuto. Al tocar `sw.js` o assets cacheados, subir la versión del cache (`VERSION` en `sw.js`).

## Roadmap

- Dominio propio
- Versión nativa para App Store con push notifications reales y sync
- Tests unitarios para la lógica de fechas si el código crece
