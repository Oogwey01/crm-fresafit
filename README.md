# Fresafit CRM

CRM interno del equipo Fresafit. **Fase 3**: migración del tablero de tareas
(antes app estática con `localStorage`) a **Next.js + Supabase + Vercel**, con
login, roles y base de datos compartida en la nube.

> La app original (Fase 1, JS vanilla) quedó archivada en [`legacy/`](legacy/)
> como referencia.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **React 19**
- **Tailwind CSS v4** + **shadcn/ui**
- **@dnd-kit** para el arrastrar-y-soltar del Kanban
- **Supabase** (Postgres + Auth + Row Level Security)
- Deploy en **Vercel**

## Puesta en marcha (local)

1. **Instalar dependencias**

   ```bash
   pnpm install
   ```

2. **Crear el proyecto Supabase** en [supabase.com](https://supabase.com) y copiar
   las credenciales (Project Settings → API):

   ```bash
   cp .env.example .env.local
   # editar .env.local con:
   #   NEXT_PUBLIC_SUPABASE_URL
   #   NEXT_PUBLIC_SUPABASE_ANON_KEY
   #   SUPABASE_SERVICE_ROLE_KEY   (solo para los scripts de seed/import)
   ```

3. **Aplicar el esquema y las policies.** Opción sencilla: pegar el contenido de
   `supabase/migrations/*.sql` (en orden) en el **SQL Editor** de Supabase.
   Opción CLI:

   ```bash
   supabase link --project-ref <tu-ref>
   supabase db push
   ```

4. **Sembrar el equipo y las tareas de ejemplo** (crea los 4 usuarios):

   ```bash
   node --env-file=.env.local scripts/seed.mjs
   # Contraseña inicial: Fresafit2026!  (cámbienla tras el primer login)
   ```

5. **Arrancar**

   ```bash
   pnpm dev
   # http://localhost:3000  →  login  →  /tareas
   ```

## Importar datos de la app antigua (opcional)

Si Armando tiene tareas reales en la app Fase 1: descargarlas con **"Respaldar
datos"** (genera un `.json`) y cargarlas:

```bash
node --env-file=.env.local scripts/import-legacy.mjs ruta/al/respaldo.json
```

## Deploy en Vercel

1. Conectar el repo en [vercel.com/new](https://vercel.com/new).
2. Configurar las variables de entorno del proyecto (Settings → Environment
   Variables): `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   (La `service role key` **no** va en Vercel; es solo para scripts locales.)
3. Deploy. Opcional: dominio privado `crm.fresafit.com`.

> Alternativa: instalar la integración de **Supabase** desde el Marketplace de
> Vercel, que inyecta las variables automáticamente.

## Estructura

```
app/
  login/                  # pantalla de login (Supabase Auth)
  auth/                   # callback + signout
  (app)/                  # área protegida (requiere sesión)
    tareas/               # tablero Kanban (módulo completo) + Server Actions
    clientes|pedidos|…/   # placeholders de la Fase 2
components/
  ui/                     # shadcn/ui
  sidebar.tsx             # barra lateral
  tareas/                 # Board, Column, TaskCard, TaskDialog, TaskFilters
lib/
  supabase/               # clientes browser/server + refresco de sesión
  catalogos.ts            # estados, prioridades, áreas, módulos
  types.ts, fecha.ts
proxy.ts                  # protección de rutas (Next 16; antes middleware.ts)
supabase/migrations/      # esquema + RLS
scripts/                  # seed.mjs, import-legacy.mjs
```

## Roles y seguridad (RLS)

- `admin` (Armando): control total y gestión de usuarios.
- `miembro`: ve todo el tablero, crea y mueve/edita tareas; borra solo las suyas.

Las policies viven en `supabase/migrations/20250101000001_rls.sql` y son el
modelo **baseline** — ajustable según la jerarquía que defina Armando, sin tocar
la interfaz.
