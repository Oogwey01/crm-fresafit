# Cómo está armado el CRM

Este CRM cambia todas las semanas. Lo que sigue son las decisiones que ya se
tomaron, para no volver a discutirlas cada vez y para que lo nuevo no derive de
lo viejo. Si algo aquí estorba, cámbialo — pero cámbialo aquí también.

## Las reglas que no se tocan

1. **`CANALES_SOLO_LECTURA = true`** en [lib/inventario/escritura-canales.ts](lib/inventario/escritura-canales.ts).
   El CRM no escribe stock en Tienda Nube, Mercado Libre ni TikTok. Está
   hardcodeado y no en una variable de entorno **a propósito**: pasó después de
   que una escritura borrara 27 unidades reales. No lo conviertas en env var
   "para simplificar".
2. **`.env.local` apunta a PRODUCCIÓN.** Correr un script en la laptop toca la
   base real. Introspección (`supabase gen types`) sí; escrituras, nunca.
3. **Las migraciones SQL se pegan a mano** en el SQL Editor de Supabase. Escribe
   el `.sql` idempotente en `supabase/migrations/` y di qué archivo correr. Los
   tipos se regeneran solos en el siguiente `pnpm dev`; para forzarlo,
   `pnpm gen:types`. Sin eso el compilador seguiría creyendo en el esquema viejo
   y dejaría pasar columnas que ya no existen.

   **Nunca `supabase db push`.** Pegar en el SQL Editor no escribe en
   `supabase_migrations.schema_migrations`, así que las 84 migraciones locales
   figuran con la columna Remote VACÍA (compruébalo con `supabase migration
   list`): para el CLI esta base está virgen y un push intentaría reaplicarlas
   todas de golpe contra producción. El historial se podría reparar
   (`migration repair --status applied`, que marca sin ejecutar), pero antes hay
   que verificar una por una que están aplicadas — marcar como aplicada una que
   nunca corrió la deja fuera para siempre.
4. **Los `useMemo` de [components/metricas/panel.tsx](components/metricas/panel.tsx)
   son deliberados**: mueven los filtros de categoría y talla sin round-trip.
   No los subas al servidor sin preguntar.
5. **El marcador de caveats es `OJO`, no `TODO`.** En español "TODO/TODOS"
   significa "all" y aparece ~35 veces como palabra normal: cualquier búsqueda
   de pendientes por `TODO` da puros falsos positivos.
6. **Despliegue**: `git push vercel main` (repo Oogwey01/crm-fresafit). `origin`
   no despliega.

## Dónde va cada cosa

```
app/(app)/<modulo>/page.tsx      Server Component: consulta y arma props
app/(app)/<modulo>/actions.ts    Barril de acciones (o el archivo, si es corto)
app/(app)/<modulo>/acciones/     Una familia de acciones por archivo
app/api/<canal>/<paso>/route.ts  OAuth, webhooks y crons de los canales
components/<modulo>/             UI del módulo, en español
components/compartido/           UI y hooks que usan VARIOS módulos
components/layout/               El armazón: sidebar, nav móvil, tema, logo
components/ui/                   shadcn, sin tocar
lib/<dominio>/                   Lógica de dominio y acceso a datos
```

**Los tipos de dominio viven en `lib/`, nunca en `components/`.** Si una página
construye un dato, su tipo no puede pertenecer al componente que lo pinta. El
vocabulario del negocio está en [lib/types.ts](lib/types.ts), derivado de las
listas de [lib/catalogos.ts](lib/catalogos.ts). Los `*Input` de formulario sí se
quedan en su `actions.ts`: son el contrato del action, no dominio.

**Dos familias de tipos, y no compiten.** `lib/types.ts` es el vocabulario del
negocio —lo que las pantallas manejan—; `lib/supabase/tipos-bd.ts` es el
esquema real, generado, y NO se edita a mano. Para las filas que se construyen
en trozos antes de un insert o un update, usa `TablesInsert<"tabla">` /
`TablesUpdate<"tabla">` del generado en lugar de `Record<string, unknown>`: es
lo que hace que una columna mal escrita salte en el build y no en producción.

`lib/types.ts` es de TIPOS. El comportamiento va aparte
([lib/tareas/reglas.ts](lib/tareas/reglas.ts) es el ejemplo).

## Consultas a Supabase

**PostgREST corta en ~1000 filas sin devolver error.** Es el bug que más veces
ha aparecido: una pantalla que "funciona" mostrando datos incompletos. Un
`.limit(5000)` no protege de nada.

- Si la consulta debe traerlo TODO → [`traerTodo`](lib/canales/paginacion.ts),
  con un `.order()` de criterio **único** (agrega `id` de desempate: las fechas
  se repiten en las importaciones en lote).
- Si trocea claves para un `.in()` → [`traerPorLotes`](lib/supabase/lotes.ts).
- Si escribe en tandas → [`porLotes`](lib/supabase/lotes.ts) con
  `TAM_LOTE_UPSERT`. Nada de inventar un tamaño nuevo.

**Columnas explícitas, no `select("*")`.** Cada módulo tiene su constante
(`COLUMNAS_PEDIDO`, `COLUMNAS_TAREA`, `COLUMNAS_STOCK_LOG`, `COLUMNAS_GASTO`)
para que una columna nueva y pesada no se cuele a todas las pantallas sin que
nadie lo pida. La excepción es el respaldo de tareas, que quiere `*` para no
perderse nada futuro.

**Lecturas repetidas**: `profiles`, `suppliers` y `agencia_empresas` salen de
[lib/supabase/consultas.ts](lib/supabase/consultas.ts). Si te descubres
copiando un `select` a una tercera página, va ahí.

**Reemplazar un conjunto** (los compartidos de una tarea, los renglones de un
pedido): inserta primero y poda después. Borrar-luego-insertar deja el conjunto
vacío si algo falla en medio, y eso es pérdida de datos.

## Caché

[lib/supabase/cache.ts](lib/supabase/cache.ts) envuelve `unstable_cache`. Léelo
antes de agregar nada ahí: **solo puede entrar lo que la RLS le daría igual a
cualquier persona del equipo interno**, porque por dentro usa el cliente admin
(un scope cacheado no puede leer cookies). El corte de rol va FUERA del scope.

Nada por-usuario. Nada que decida por dentro qué dinero enseñar —`metricas_resumen`
y familia se quedan fuera a propósito—.

Al escribir en una tabla cacheada, la action llama a `invalidar(TAGS.x)` junto a
su `revalidatePath`.

`cacheComponents` / `'use cache'` es la migración futura; enciende PPR y cambia
el comportamiento de todos los diálogos, así que no es un cambio suelto. Lee
antes `node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`.

## Permisos

- Páginas: `await exigirModulo("<id>")` como primera línea. El catálogo decide
  (`soloAdmin`, `soloDireccion`, `espacio`) y manda al destino seguro del perfil.
  No dupliques el corte con un `if (!puedeAdministrar(rol)) redirect(...)`.
- Actions: `exigirRol("<nivel>", "<mensaje>")`.
- Rutas de canal: `autorizarCron` (crons) o `autorizarOAuth` (conectar/callback),
  ambas en [lib/canales/http.ts](lib/canales/http.ts).
- El dinero por rol pasa por `vistaDinero()` y `lib/permisos-dinero.ts`.

Todo esto es la primera capa; la RLS es el candado de verdad.

## El módulo de empresas (portal de clientes)

Gente de FUERA entra al CRM: los contactos de las empresas cliente (rol
`externo` + `profiles.empresa_id`) ven `/portal/*` y NADA más. Las reglas que
lo sostienen, y que no se relajan:

- **Todo elemento del módulo lleva `visibilidad`** (`privado` | `interno` |
  `compartido`) **y nace `interno`**. Compartir es un acto deliberado — default
  en la columna, en los formularios y en las acciones. El corte lo aplica la
  RLS, nunca la pantalla: las consultas del portal NO llevan filtro de
  visibilidad a propósito (lo que la base no da, no llega).
- **Las policies se suman (OR)**: toda policy de lectura del módulo empieza con
  su candado de rol (`es_interno()` / `es_externo()`). Sin él, una rama como
  `responsable_id = auth.uid()` le abriría a un externo lo no compartido.
- **`actividad_empresas` es evidencia**: INSERT-only, sin UPDATE/DELETE ni para
  dirección (revoke + sin policies + trigger que revienta), fuera de
  `purgar_logs`. Los triggers la llenan; `lib/actividad.ts` cubre lo que no
  pasa por una tabla (descargas, exports, logins). Las descargas de documentos
  van SIEMPRE por la acción `abrirArchivoDocumento` — la UI nunca firma URLs
  directo, o el registro se queda ciego.
- **Un solo componente para las dos caras** (bandejas, documentos, avance,
  reporte): lo que cambia entre el equipo y el cliente es la RLS de la sesión y
  un `puedeGestionar`/`puedeEditar`. Dos componentes acabarían enseñando cosas
  distintas.
- **Correo**: `lib/correo/` (Resend por `fetch`, sin SDK). Sin
  `RESEND_API_KEY` degrada a campana+push sin romper. Urgente = inmediato con
  `after()`; el resto lo agrupa `/api/cron/portal` (cron-job.org, diario).
- **Altas de externos**: `scripts/crear-usuario.mjs --rol externo --empresa
  <slug> --rol-portal <admin_cliente|colaborador>`. La frontera casa↔portal no
  se cruza con un cambio de rol (checks en BD + guarda en /equipo).

## Formato y catálogos

Nunca escribas un formateador local. Ya existen y una copia se desvía:
- Dinero y números: `formatearMXN`, `formatearMXNCorto`, `formatearNumeroCorto`
  ([lib/moneda.ts](lib/moneda.ts)).
- Fechas: [lib/fecha.ts](lib/fecha.ts). Todas anclan la zona a
  `America/Mexico_City`; sin eso el servidor y el navegador pintan distinto y
  React truena la hidratación.
- Nombres y colores de estados, roles, áreas, canales: `obtenerX()` de
  [lib/catalogos.ts](lib/catalogos.ts), nunca un `.find()` a mano ni un mapa
  local paralelo.

Los canales tienen dos nombres que no son intercambiables: el slug
(`tiendanube`) y el canal de venta (`tienda_nube`). El traductor está en
[lib/canales/tipos.ts](lib/canales/tipos.ts).

## Componentes

- Server Component por defecto; `"use client"` solo donde hay interacción.
- Llamar a un action desde el cliente:
  [`useAccionServidor`](components/compartido/use-accion-servidor.ts). Trae la
  transición, el toast de error y el de éxito.
- Cuando un componente pasa de ~400 líneas, lo que sobra suele ser un diálogo o
  un hook con vida propia. Sácalo a su archivo del mismo módulo; `compartido/`
  es solo para lo que usan varios.

## Acciones

Un `actions.ts` que pasa de ~300 líneas y mezcla sub-dominios se parte en
`acciones/<familia>.ts` y el archivo viejo queda como **barril**. El barril NO
lleva `"use server"`: Turbopack rechaza `export *` en un módulo de acciones, y
no hace falta porque cada acción ya viene marcada desde su origen. Lo que
comparten (helpers, constantes, tipos de entrada) va en `acciones/comun.ts`,
también sin `"use server"` — ahí solo caben funciones async.

## Antes de dar algo por bueno

```bash
pnpm build     # corre el typecheck
pnpm lint
```

Las pruebas con sesión real las corre el usuario (`/verify`): las credenciales
de siembra ya no sirven.
