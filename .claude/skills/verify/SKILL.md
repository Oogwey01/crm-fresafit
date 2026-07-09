---
name: verify
description: Receta para verificar el CRM Fresafit end-to-end (levantar app, login, manejar el navegador y capturar evidencia). Usar al verificar cambios de UI o server actions.
---

# Verificar Fresafit CRM end-to-end

## Levantar

```bash
pnpm dev --port 3007        # en background; listo en ~2 s
```

Requiere `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (ya existe). La app usa la BD de Supabase EN VIVO — verificar solo con flujos de lectura o datos claramente de prueba; no crear/borrar datos reales del equipo.

## Manejar el navegador

No hay Playwright en el proyecto. Instalar `playwright-core` en el scratchpad (sin descarga de navegador) y usar el Chromium ya cacheado:

```js
import { chromium } from "playwright-core";
const EXE = process.env.HOME +
  "/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const browser = await chromium.launch({ executablePath: EXE });
```

(Si esa carpeta no existe, `ls ~/Library/Caches/ms-playwright/` y ajustar versión.)

## Login

Formulario en `/login` (`input[type=email]`, `input[type=password]`, `button[type=submit]`); redirige a `/tareas`.

- Cuenta de desarrollo: `aaron@fresafit.com.mx` (rol `direccion`).
- Contraseña seed: `Fresafit2026!` (los usuarios pueden haberla cambiado; Aaron es la apuesta segura).
- Para probar como otro rol, usar cuentas seed de `scripts/seed.mjs` (miembro: p.ej. `luna...`), con cuidado de no mutar datos.

## Gotchas de selectores

- Los chips de "Carga por persona" muestran SOLO el primer nombre y sin espacio antes del contador ("Juan1"). Seleccionar por `button[title^="Nombre Completo"]` (el title trae el nombre completo).
- Toggles segmentados (alcance "Mis tareas | Todas", vistas "Tabla | Tablero | Calendario") son `getByRole("button", { name, exact: true })`.
- Descargas (botón "Respaldar"): usar `page.waitForEvent("download")` en `Promise.all` con el clic.
- El estado de BD en vivo se verifica con `node --env-file=.env.local scripts/verificar-bd.mjs` (solo lectura).
