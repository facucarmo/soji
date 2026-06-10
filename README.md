# Soji 🐾

El cuidado de tu mascota, simple. PWA para registrar vacunas, desparasitaciones, visitas al veterinario y peso. Sin cuentas, sin publicidad, gratis — todo se guarda en el dispositivo (localStorage).

## Correr local

Necesita servirse por HTTP para que funcione el service worker:

```
npx http-server -p 8123 -c-1 .
```

Después abrir http://localhost:8123

## Estructura

- `index.html` — toda la app (HTML + CSS + JS en un solo archivo)
- `manifest.webmanifest` — manifest de la PWA
- `sw.js` — service worker (cache offline)
- `icons/` — íconos de la app

## Funcionalidades

- Multi-mascota, con perfil editable y foto
- Registro de vacunas (con refuerzo), desparasitaciones (con repetición), visitas y peso
- Historial con filtros, edición y borrado de registros
- Alertas de vencimientos (próximos 90 días) + notificaciones del navegador opcionales
- Gráfico de evolución de peso
- Exportar / restaurar respaldo en JSON

## Pendiente / ideas

- Deploy (GitHub Pages / Netlify)
- A futuro: app nativa para App Store con push notifications reales
