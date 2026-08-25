# BITÁCORA — CRM FresaFit

Lo más nuevo arriba.

---

## 24-ago-2026 · Los personalizados que no aparecían, y un bug que llevaba 3 semanas comiéndose las ventas

**Rama:** `sesion/2026-08-24` · **Detonante:** Aaron preguntó por qué los pedidos
de Tienda Nube **#1383, #1385, #1386 y #1391** no salían en el CRM.

### Lo que se encontró

Las cuatro órdenes **sí estaban** en `sale_orders`. Se separaban después, y por
dos motivos distintos que se veían igual desde fuera:

**1. La hebilla de gamuza nunca tuvo ficha de maquila.**
`20261005000000_maquila_gamuza_personalizados.sql` sembró la gamuza **solo para
powerlift** (su filtro exigía `nombre ilike '%powerlift%'`) y dejó fuera la
hebilla a propósito. Sin ficha en `maquila_productos`, la ingesta descarta el
renglón en silencio. Aaron confirmó que **sí son de Eduardo**.

**2. 🐛 El bug grande: `variant_id` viene con dos tipos.**
La API de Tienda Nube devuelve `products[].variant_id` **número** en el listado
de órdenes (que usa el cron) y **texto** en el detalle `/orders/{id}` (que usa el
webhook):

```
GET /orders          →  1508700595    number   ← cron
GET /orders/{id}     → "1508700595"   string   ← webhook
```

El CRM cruza contra mapas con llaves numéricas, así que el texto del webhook no
encontraba nada. Cada venta avisada por webhook entraba **sin `producto_id` y sin
pedido de maquila**. El tipo de TypeScript declaraba `number`, así que el
compilador no podía avisar.

**Alcance medido:** 203 de 238 renglones de Tienda Nube de agosto (**85%**), en
**178 órdenes completas** — nunca líneas sueltas, porque cada webhook trae una
orden. Empezó a doler cuando los webhooks se volvieron el camino principal; antes
todo entraba por el cron y cruzaba bien.

**Qué NO se dañó:** el dinero. Los totales viven en `sale_orders` y se guardan
aparte. Lo que venía cojo es todo lo que agrupa **por producto**: métricas,
inventario, qué se vende más.

### Qué se hizo

| Archivo | Qué |
|---|---|
| `lib/tiendanube/api.ts` | `normalizarOrden()` deja los ids numéricos en la **frontera**, vengan del listado o del detalle. Arregla de un golpe ventas y maquila. |
| `lib/canales/ventas-cuadre.ts` | `RenglonRefrescado` acepta `producto_id` |
| `lib/{tiendanube,mercadolibre,tiktok}/ventas.ts` | los tres importadores lo mandan en el refresco |
| `20261013000000_maquila_hebilla_gamuza.sql` | **120 fichas** de hebilla gamuza (`hebilla` + `bordado_gamuza`, tarifa $320 que ya existía) |
| `20261013000100_reparar_producto_id_ventas.sql` | repara los **207** renglones huérfanos + la RPC `sincronizar_renglones_venta` ahora rellena `producto_id` cuando está vacío |

**Por qué la RPC también:** el upsert de altas usa `ignoreDuplicates`, así que un
renglón mal guardado **no se corregía nunca solo**. Esa RPC es el único camino de
reparación de lo ya importado, y le faltaba justo esa columna. Por eso 207
renglones llevaban tres semanas huérfanos mientras las syncs les pasaban por
encima todos los días.

### Verificación (en seco, sin escribir en la base)

- `tsc --noEmit` y `eslint` limpios.
- Migración 1: alcanza 120 productos, **0** colisiones, **0** SBD, **0** sin SKU
  PRM. Las 3 variantes reportadas entran.
- Migración 2: repara 207 de 224. Los 17 que quedan son catálogo **borrado**
  (líneas OG descontinuadas). Muestreo de 5: la descripción de la venta cruza
  exacto con el nombre del producto.

### ⚠️ Trampa documentada

Tras aplicar, correr la sync **NORMAL**, nunca la `completo` de 90 días:
`aplicarRenglonesMaquila` **no tiene corte por fecha** (las ventas sí lo tienen,
con `separarAltas`), así que una pasada completa metería ~36 cinturones **ya
entregados** como «pendiente de producción», encima de los 77 pendientes reales
de Eduardo.

### Decisión: `bajo_pedido` NO se toca

Da fichas en **/personalizados** (la del diseñador). La gamuza es un acabado de
catálogo, no un cinturón con arte del cliente — las 118 fichas de gamuza
powerlift viven así desde octubre: en /maquila sí, en /personalizados no. Si
Armando quiere que el diseñador también las vea, es otra decisión y otra
migración.

### Al integrar a `main` (24-ago, Aaron)

La rama de la sesión partía de `main` del **13 de agosto** y no conocía los 13
commits posteriores. Eso obligó a tres ajustes antes de que nada tocara
producción:

1. **La RPC se reescribió sobre la versión viva, no sobre la del borrador.**
   `20261021000000_envio_subestado.sql` ya había recreado
   `sincronizar_renglones_venta` para añadirle `envio_subestado` y
   `envio_logistica`. El `create or replace` del borrador, escrito sobre una
   copia anterior, los habría borrado **en silencio** y el subestado de envío de
   Mercado Libre habría dejado de sincronizarse. La migración que se aplicó
   parte de la versión de 20261021 y solo AÑADE `producto_id`.
2. **Las migraciones se renumeraron** de `20261013…` a `20261027…`. Sus
   timestamps eran anteriores a siete migraciones ya aplicadas, y Supabase las
   ordena por nombre.
3. **Se aplicaron desde la terminal, no por el SQL Editor**, y antes en un
   ensayo con `ROLLBACK` contra producción para ver los efectos reales sin
   confirmarlos.

Números finales, medidos en producción: **120** fichas de hebilla gamuza (igual
que lo previsto) y **210** renglones reparados de 227 huérfanos —no 207 de 224—,
quedando los 17 de catálogo borrado. Se comprobó que la RPC conserva
`envio_subestado` y `envio_logistica` y que ahora también rellena `producto_id`.

La lección que conviene no repetir: **una rama que va a tocar la base tiene que
partir de `main` actualizado**, y cualquier `create or replace` debe copiarse de
la última versión de la función, no de la que uno tenga a mano.
