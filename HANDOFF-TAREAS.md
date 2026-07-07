# Handoff — Módulo Tareas completo (rama `feat/tareas-spec-completo`)

Para: **Aaron**. Esta rama completa el módulo de Tareas para cumplir el spec de Armando
(4 roles, tablero por área, detalle rico, RLS por rol) sobre tu baseline. **No se aplicó
nada al Supabase en vivo ni se mergeó a `main`** — revísalo y actívalo tú.

Verificación hecha: `next build` pasa (typecheck OK). No hay pruebas contra la BD en vivo.

## Qué añade

- **4 roles** (`direccion`, `coordinador`, `miembro`, `externo`) — reemplazan `admin`/`miembro`.
- **Áreas del spec**: `direccion, operaciones, diseno, contenido, logistica, tech`.
- Estado `en_progreso` → **`en_proceso`**; prioridad **sin `urgente`** (alta/media/baja).
- **Tablero por área** (carriles) + vista **"Mis tareas"** por defecto + gating por rol en la UI.
- **Detalle rico**: comentarios, checklist, enlaces, adjuntos (Storage), etiquetas, historial de actividad.
- **RLS por rol** + trigger que limita a `miembro` a cambiar solo `estado` de sus tareas.
- **Seed** con los **11 usuarios reales** (correos del spec).

## Cómo aplicar (orden importa)

1. En Supabase → **SQL Editor**, pega y ejecuta EN ORDEN:
   1. `supabase/migrations/20250102000000_roles_areas_estados.sql`
   2. `supabase/migrations/20250102000001_tablas_satelite.sql`
   3. `supabase/migrations/20250102000002_storage_adjuntos.sql`
   4. `supabase/migrations/20250102000003_rls.sql`
   (o `supabase db push` si prefieres CLI.)
2. Siembra el equipo real: `node --env-file=.env.local scripts/seed.mjs`
   - Crea los 11 usuarios (password inicial `Fresafit2026!`).
3. `pnpm dev` → probar.

## Notas / decisiones a revisar

- **Migración de datos**: `admin`→`direccion`, `en_progreso`→`en_proceso`, `urgente`→`alta`,
  y áreas viejas → nuevas (mapeo documentado en la migración 1). Es segura sobre datos existentes.
- **Correos**: el seed nuevo usa los **correos reales** (`armando@fresafit.com.mx`, gmail/hotmail…),
  distintos a los `@fresafit.com` de tu seed inicial. Si ya sembraste los 4 `@fresafit.com`, quedarán
  duplicados lógicos; decide si borras los viejos.
- **es_admin()** ahora significa `direccion` (para no romper las policies de las tablas esqueleto).
  Se agregaron `mi_rol()`, `mi_area()`, `es_gestor()`, `puede_ver_tarea()`, `puede_contribuir_tarea()`.
- **Storage**: bucket privado `adjuntos`; ruta `adjuntos/<task_id>/<archivo>`; policies espejan la
  visibilidad de la tarea. Los adjuntos se ven con URL firmada (`urlAdjunto`).
- **Server Actions** (`app/(app)/tareas/actions.ts`) validan rol además de RLS (defensa en profundidad).

## Probar por rol (matriz esperada)

- **dirección/coordinador**: ven todo; crean, asignan, editan, borran; comparten con externos.
- **miembro**: ve su ÁREA + asignadas; de las SUYAS solo mueve estado; comenta y adjunta; NO crea/edita meta.
- **externo** (Aaron): solo ve tareas **compartidas** con él; comenta lo que ve; no crea.

Cualquier ajuste de las policies es en `20250102000003_rls.sql` sin tocar la interfaz.
