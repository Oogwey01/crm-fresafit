# Optimización de la base — orden de aplicación

Auditoría del 04/08/2026. Siete migraciones nuevas, de la `20260824` a la `20260830`.
Se pegan en el **SQL Editor de Supabase**, en el orden de abajo.

**La regla que no hay que saltarse:** primero el SQL, después el código. Todas las
migraciones son aditivas —crean funciones e índices, no quitan nada que el código
actual use—, así que la base puede ir por delante sin romper nada. Al revés no: el
código nuevo llama a funciones que, si no están, devuelven error.

---

## 1 · `20260824000000_rls_initplan.sql` — el cambio que más se nota

Las políticas de seguridad preguntaban «¿quién eres?» **una vez por cada fila**
examinada. En una tabla de 20 filas da igual; en las ventas, que Métricas recorre
de a miles, no. Medido sobre 20.000 filas: **52 ms → 1.5 ms**.

Recorre el catálogo y reescribe cada política envolviendo esas llamadas. Corre
entero en una transacción: si algo fallara, no pasa nada en absoluto.

**Antes de seguir, comprobar:**
- Las tres consultas de verificación del pie del archivo (la primera debe dar cero
  filas; la segunda, el mismo número de políticas antes y después; la tercera, cero).
- Entrar al CRM con un usuario de cada rol y confirmar que cada quien ve lo suyo:
  dirección llega a Proveedores y Finanzas, un miembro no ve costos de proveedor,
  un externo sigue acotado en Tareas.

Deja una tabla `zz_respaldo_policies_20260824` con el estado previo. La borra la
migración de higiene, **solo cuando estas comprobaciones estén hechas**.

## 2 · `20260825000000_indices.sql` — ⚠️ pegar bloque por bloque

Índices que faltaban: doce llaves foráneas sin indexar (borrar una tarea recorría
la tabla de avisos entera), las columnas que apuntan a `profiles`, y compuestos
para lo que las pantallas piden de verdad.

**Este archivo tiene tres bloques separados por una línea de `═══`. Hay que
pegarlos de uno en uno, esperando a que cada uno termine.** El editor SQL corre
todo lo que se le pega en una sola transacción, y cada índice retiene un candado
sobre su tabla hasta el final: pegar el archivo entero deja las cuarenta tablas
bloqueadas a la vez mientras la aplicación escribe, y puede provocar un deadlock
—exactamente lo que ya pasó una vez con `personalizados`—. Cada bloque tiene su
propio `set lock_timeout`, así que si alguno aborta, se vuelve a pegar y ya.

Mejor en hora valle.

## 3 · `20260826000000_metricas_resumen.sql`

Métricas bajaba 25.000 filas al navegador para sumarlas ahí. Ahora suma la base.

Medido en local con un año de datos (20.000 ventas y 15.000 órdenes): lo que
viajaba eran **~3.6 MB** de JSON; ahora son **~11 KB** de cifras ya hechas más la
primera página de la tabla. El tiempo de consulta en la base es prácticamente el
mismo —unos 6 ms en los dos casos—, así que la mejora es de payload, que es
justamente lo que pesa desde Vercel. De paso desaparece el tope de 5.000
renglones, y con él el aviso de «las ventas más antiguas no están contadas».

**Antes de desplegar el código**, cuadrar contra la pantalla actual con el mismo
rango que tenga puesto:
```sql
select jsonb_pretty(public.metricas_resumen('2026-07-01', '2026-07-31'));
```
El pie del archivo dice qué cifra corresponde a qué tarjeta. Diferencias de
centavos son normales (Postgres suma exacto, JavaScript sumaba en coma flotante).

## 4 · `20260827000000_reporte_fresafit.sql`

Lo mismo con el reporte de cierre: de diez lecturas paginadas a una llamada.
Incluye el arreglo del conteo de ventas por ficha duplicada.

**Antes de desplegar**, cuadrar contra el último mes cerrado (ejemplo en el pie
del archivo) renglón por renglón.

## 5 · `20260828000000_bodega_lote.sql`

Descontar una recepción era una llamada por renglón, en serie. Ahora es una sola.

## 6 · `20260829000000_higiene.sql`

Seis arreglos chicos: `stock_log` ya admite movimientos de TikTok (hoy los
rechaza y el error muere en la consola), los personalizados nacen en «recibido» y
no en «diseño», y se quitan permisos que sobraban.

⚠️ **La última línea borra `zz_respaldo_policies_20260824`.** Si las
comprobaciones del paso 1 no están hechas, comentar esa línea y pegar el resto.

## 7 · `20260830000000_retencion_logs.sql` — borra datos

Las bitácoras crecían sin techo. Conserva **90 días** de `stock_log`,
`stock_canal_log`, `task_activity` y las notificaciones **ya leídas** (las no
leídas se quedan, aunque sean viejas).

**Estrenarla siempre en ensayo**, que es el modo por defecto:
```sql
select jsonb_pretty(public.purgar_logs());   -- cuenta, no borra
```
Revisar los números y solo entonces `purgar_logs(false)`.

Para que corra sola: dar de alta en **cron-job.org**, una vez por semana,
`GET https://crm-fresafit-six.vercel.app/api/cron/purga` con la cabecera
`Authorization: Bearer <CRON_SECRET>`. Si la respuesta trae
`quedan_pendientes: true`, hay más de lo que cabe en una pasada y hay que
repetirla.

Sobre quién puede disparar esa URL: **solo el cron borra**. Abriéndola desde el
navegador con sesión de dirección se obtiene únicamente el conteo, nunca el
borrado — es un GET, y un enlace enviado por chat no puede provocar un borrado
irreversible. Para purgar a mano está el SQL Editor.

---

## Después

Desplegar el código con `git push vercel main` y revisar Métricas, Reportes y
Bodega con una sesión real.

## Lo que NO entró, a propósito

`sales` y `sale_orders` siguen sin llave foránea: se relacionan parseando el texto
de `referencia_externa`. Es la deuda estructural más cara que queda, y se dejó
para un plan aparte porque implica backfill de todo el histórico y tocar los tres
sincronizadores.
