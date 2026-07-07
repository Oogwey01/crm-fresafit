# CRM Fresafit — Nota técnica (handoff para quien lleve la programación)

Armando (fundador, no técnico) arrancó un CRM interno por fases. Esta es la Fase 1
(módulo de Tareas) y falta la Fase 3 (nube + auth + roles), que requiere un perfil
técnico. Este doc da el contexto y la ruta de migración propuesta. Todo es debatible
— es una recomendación, no un dogma.

## 1. Qué es hoy (Fase 1)

App **100% estática**: HTML + CSS + **JavaScript vanilla**, sin frameworks, sin build,
sin dependencias, sin backend. Se abre con doble clic en `index.html`. Datos en
`localStorage` (single-user, single-machine).

```
09_CRM/
├─ index.html
├─ css/styles.css
└─ js/
   ├─ data.js            # catálogos: EQUIPO, ESTADOS, PRIORIDADES, AREAS, MODULOS
   ├─ storage.js         # <-- ÚNICA capa de persistencia (el punto de migración)
   ├─ app.js             # shell + router de módulos (REGISTRO_MODULOS)
   └─ modules/
      └─ tasks.js         # módulo Tareas: { render(contenedor) }
```

**Contrato de módulo:** cada área expone un objeto `{ render(contenedor) }` y se
registra en `REGISTRO_MODULOS` (app.js) + `activo:true` en `MODULOS` (data.js).
Se suman módulos sin tocar los existentes.

**Contrato de datos:** todo pasa por `Storage` (storage.js):
`obtenerTareas()`, `guardarTareas()`, `exportarRespaldo()`, `importarRespaldo()`.
Formato guardado: `{ schemaVersion: 1, tareas: [...] }`, con `migrarSiHaceFalta()`.

Esto se diseñó a propósito así: **migrar a nube = reescribir SOLO `storage.js`** (y
añadir auth). La UI no cambia.

## 2. Fase 3 — stack recomendado

- **Supabase** (Postgres gestionado + Auth + Row Level Security + API REST/JS auto).
  - Auth: email+password (o magic link). Tabla `profiles` con `rol` y `area`.
  - **RLS** para que cada usuario vea/edite según rol y área (la jerarquía que quiere Armando).
- **Vercel** (o Netlify) para servir el frontend en una URL privada (`crm.fresafit.com`).
- Ambos tienen **free tier** suficiente para ~5 usuarios; escalar a Supabase Pro (~$25/mo) cuando haga falta.

## 3. Ruta de migración (alto nivel)

1. Modelar en Postgres: `tasks`, `profiles`/`users`, y las tablas de los módulos Fase 2
   (`customers`, `orders`, `inventory`, `finances`, …). Mantener el `id` como PK.
2. Reescribir `storage.js` para que sus funciones llamen al cliente de Supabase
   (async). La firma pública se mantiene; conviene volver async las llamadas en los
   módulos (hoy son síncronas) — cambio mecánico acotado.
3. Añadir capa de auth: pantalla de login + guardado de sesión; `app.js` filtra los
   módulos visibles según `rol`/`area` del usuario (ya hay flag `activo` por módulo).
4. Definir **RLS policies** por rol/área. Backups automáticos (Supabase los trae) +
   respaldo manual export ya existente como red de seguridad.
5. Deploy en Vercel + dominio.

## 4. Notas

- Sin secretos en el repo del frontend: solo la `anon key` de Supabase (protegida por RLS).
- Datos sensibles (clientes, finanzas) ⇒ RLS bien definido antes de meter data real.
- Equipo inicial: Armando (dirección/admin), René (ops), Emiliano (ops/mkt), Aaron (mkt).

Cualquier ajuste al stack o al enfoque, con toda confianza — esto es una base, no un dogma.
