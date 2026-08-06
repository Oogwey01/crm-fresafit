/* ============================================================================
   lib/mercadolibre/sync.ts — Sincronización Mercado Libre → tabla `products`
   ----------------------------------------------------------------------------
   Cada "unidad" de ML (item sin variaciones, o item+variación) es un renglón
   de `products`, mapeado por (meli_item_id, meli_variation_id).

   Matching al importar (stock unificado con Tienda Nube):
     1. Unidad ya vinculada → esa fila.
     2. Sin vincular y con SKU → si EXACTAMENTE una fila del CRM tiene ese sku
        y sigue sin vínculo ML, se vincula (caso típico: producto que vino de
        Tienda Nube con el mismo SKU). Con 0 o 2+ candidatas: fila nueva,
        nunca se adivina.
     3. Sin SKU → fila nueva siempre.

   Inventario: para productos vinculados también a Tienda Nube, TN gobierna el
   stock por completo y la sync de ML NO lo toca. Mercado Libre nunca escribe
   stock en Tienda Nube; el inventario de TN solo cambia con el ajuste manual
   del CRM (ajustarStock). Al vincular por SKU, ML se alinea hacia el CRM.

   Mercado Full es la excepción, y por eso tiene columna propia: sus unidades
   están en un centro de ML, no en la bodega. `stock` sigue siendo la bodega
   —gobernada por Tienda Nube cuando el producto también vive allá— y
   `meli_stock_full` guarda lo que hay en el depósito. Los dos números conviven
   en la misma ficha; sumarlos en uno solo era lo que hacía invisible el
   inventario de Full en el CRM.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarCambiosProductos } from "@/lib/inventario/escribir-productos";
import { mezclarDatosIntegracion } from "@/lib/canales/integraciones";
import {
  conexionMercadolibre,
  listarItemsML,
  obtenerItemML,
  skuML,
  LOGISTICA_FULL,
  type ConexionML,
  type ItemML,
} from "@/lib/mercadolibre/api";
import { propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";
import { registrarStockLog, type EntradaStockLog } from "@/lib/inventario/stock-log";
import { HUB_VENTAS_ACTIVO } from "@/lib/inventario/hub-config";
import { esSimulacro, puedeEscribir } from "@/lib/inventario/escritura-canales";
import { tipoDesdeProducto } from "@/lib/inventario/tipo-producto";

export type ResumenSyncML = {
  items: number;
  creados: number;
  actualizados: number;
  vinculados: number;
  desactivados: number;
  /* Publicaciones que no generaron ficha porque su inventario ya lo representa
     otra (las gemelas de catálogo de Mercado Libre). */
  gemelas: number;
};

export type UnidadML = {
  itemId: string;
  variationId: number | null;
  sku: string | null;
  nombre: string;
  variante: string | null;
  precio: number | null;
  stock: number;
  activo: boolean;
  /* "fulfillment" (Mercado Full), "cross_docking", "drop_off"… Es del item, así
     que todas las variaciones de una publicación comparten el valor. */
  logisticType: string | null;
  /* "MLMU…": la unidad de INVENTARIO de ML. Dos publicaciones que lo comparten
     mueven la misma bodega (pasa cuando ML clona la publicación para su
     catálogo), así que deben caer en una sola ficha del CRM. */
  userProductId: string | null;
  /* Galería de la unidad, en orden (la de la variación si la tiene; si no, la
     del item). Vacía = la publicación no trae fotos. */
  imagenes: string[];
  /* URL pública de la publicación (del item: las variaciones la comparten). */
  permalink: string | null;
};

type FilaProducto = {
  id: string;
  stock: number;
  sku: string | null;
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
  meli_logistic_type: string | null;
  meli_user_product_id: string | null;
  meli_permalink: string | null;
};

const CAMPOS_FILA =
  "id, stock, sku, tiendanube_product_id, tiendanube_variant_id, meli_item_id, meli_variation_id, meli_logistic_type, meli_user_product_id, meli_permalink";

/* Una publicación de ML apuntando a una ficha del CRM (tabla meli_publicaciones). */
type Publicacion = {
  meli_item_id: string;
  meli_variation_id: number | null;
  producto_id: string;
  meli_user_product_id: string | null;
  principal: boolean;
};

/* Llave de una "unidad" de ML (item sin variaciones, o item+variación). La usan
   la sync y el reporte de reconciliación para mapear contra `products`. */
export function clave(itemId: string, variationId: number | null): string {
  return `${itemId}:${variationId ?? ""}`;
}

/* URL utilizable de una foto de ML (prefiere https). */
function urlFoto(f: { secure_url?: string | null; url?: string | null }): string | null {
  return f.secure_url?.trim() || f.url?.trim() || null;
}

/* Galería de una variación: sus `picture_ids` resueltos contra las fotos del
   item, en el orden que marca la variación. Si no declara fotos propias hereda
   las del item (es lo que muestra la publicación). */
function galeriaDe(item: ItemML, ids?: string[]): string[] {
  const fotos = item.pictures ?? [];
  if (ids?.length) {
    const porId = new Map(fotos.map((f) => [f.id, f]));
    const propias = ids.map((id) => porId.get(id)).filter(Boolean).map((f) => urlFoto(f!));
    const limpias = propias.filter((u): u is string => !!u);
    if (limpias.length > 0) return limpias;
  }
  return fotos.map(urlFoto).filter((u): u is string => !!u);
}

export function unidadesDe(item: ItemML): UnidadML[] {
  const activo = item.status !== "closed";
  const logisticType = item.shipping?.logistic_type ?? null;
  const userProductId = item.user_product_id ?? null;
  const permalink = item.permalink?.trim() || null;
  if (item.variations?.length) {
    return item.variations.map((v) => ({
      itemId: item.id,
      variationId: v.id,
      sku: skuML(v) ?? skuML(item),
      nombre: item.title,
      variante:
        (v.attribute_combinations ?? [])
          .map((a) => a.value_name?.trim())
          .filter(Boolean)
          .join(" / ") || null,
      precio: v.price ?? item.price ?? null,
      stock: Math.max(0, v.available_quantity ?? 0),
      activo,
      logisticType,
      userProductId,
      imagenes: galeriaDe(item, v.picture_ids),
      permalink,
    }));
  }
  return [
    {
      itemId: item.id,
      variationId: null,
      sku: skuML(item),
      nombre: item.title,
      variante: null,
      precio: item.price ?? null,
      stock: Math.max(0, item.available_quantity ?? 0),
      activo,
      logisticType,
      userProductId,
      imagenes: galeriaDe(item),
      permalink,
    },
  ];
}

/* Columnas de imagen de una unidad, para mezclar en el upsert. Se omiten cuando
   la publicación no trae fotos: mejor conservar la que ya tenga la ficha que
   dejarla sin nada. Las fichas vinculadas a Tienda Nube no pasan por aquí —
   allá manda TN, que es donde están las fotos buenas del catálogo. */
function fotos(u: UnidadML): Record<string, unknown> {
  if (u.imagenes.length === 0) return {};
  return { imagen_url: u.imagenes[0], imagenes: u.imagenes };
}

/* Guarda en `products.meli_stock_full` lo que Mercado Full tiene de cada ficha,
   y lo borra de las que dejaron de estar en Full. Solo escribe donde el número
   cambió: en una sync normal casi ninguna ficha lo tiene, así que esto son dos
   o tres updates, no uno por producto. */
async function escribirStockFull(
  fichas: Set<string>,
  fullPorFicha: Map<string, Map<string, number>>,
): Promise<void> {
  if (fichas.size === 0) return;
  const admin = createAdminClient();

  const conFull = [...fullPorFicha.entries()].map(([id, depositos]) => ({
    id,
    total: [...depositos.values()].reduce((a, n) => a + n, 0),
  }));

  if (conFull.length > 0) {
    const { data, error } = await admin
      .from("products")
      .select("id, meli_stock_full")
      .in(
        "id",
        conFull.map((f) => f.id),
      );
    if (error) throw new Error(error.message);
    const actual = new Map((data ?? []).map((f) => [f.id as string, f.meli_stock_full as number | null]));
    const cambiaron = conFull.filter((f) => actual.get(f.id) !== f.total);
    /* Estos cambios son de una sola columna, así que el helper los deja fila por
       fila: sin `nombre` (NOT NULL) no hay upsert posible, y traerlo solo para
       reescribirlo tal cual arriesgaría pisar el catálogo por ahorrar viajes que
       aquí no existen —en una sync normal casi ninguna ficha está en Full y esto
       son dos o tres updates, no uno por producto—. */
    await aplicarCambiosProductos(
      admin,
      cambiaron.map(({ id, total }) => ({ id, fila: { meli_stock_full: total } })),
    );
  }

  // Fichas que ya no tienen publicación Full: se limpia el número (un solo
  // update por tanda, y el `not is null` evita tocar las que ya están en null).
  const sinFull = [...fichas].filter((id) => !fullPorFicha.has(id));
  for (let i = 0; i < sinFull.length; i += 200) {
    const { error } = await admin
      .from("products")
      .update({ meli_stock_full: null })
      .in("id", sinFull.slice(i, i + 200))
      .not("meli_stock_full", "is", null);
    if (error) throw new Error(error.message);
  }
}

/* Upsert de un lote de items de ML, con matching por SKU y propagación. */
export async function sincronizarItemsML(
  items: ItemML[],
): Promise<Omit<ResumenSyncML, "items" | "desactivados">> {
  const admin = createAdminClient();
  const unidades = items.flatMap(unidadesDe);
  const itemIds = [...new Set(unidades.map((u) => u.itemId))];

  // 1) Filas ya vinculadas a estas unidades (consulta en tandas).
  const vinculadas = new Map<string, FilaProducto>();
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("meli_item_id", itemIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) {
      vinculadas.set(clave(f.meli_item_id!, f.meli_variation_id), f);
    }
  }

  // 2) Publicaciones ya registradas de estas unidades. Incluye las SECUNDARIAS
  //    (las que ML clonó para su catálogo), que no tienen fila propia en
  //    `products` sino que cuelgan de la ficha de su gemela.
  const publicadas = new Map<string, Publicacion>();
  const productoPorUnidadInv = new Map<string, string>(); // user_product_id → producto
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data, error } = await admin
      .from("meli_publicaciones")
      .select("meli_item_id, meli_variation_id, producto_id, meli_user_product_id, principal")
      .in("meli_item_id", itemIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as Publicacion[]) {
      publicadas.set(clave(p.meli_item_id, p.meli_variation_id), p);
    }
  }
  // Unidades de inventario que ya tienen dueño: si llega una publicación gemela,
  // se cuelga de esa ficha en vez de crear una nueva.
  const userProducts = [...new Set(unidades.map((u) => u.userProductId).filter(Boolean))] as string[];
  for (let i = 0; i < userProducts.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select("id, meli_user_product_id")
      .in("meli_user_product_id", userProducts.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const f of data ?? []) {
      productoPorUnidadInv.set(f.meli_user_product_id as string, f.id as string);
    }
  }

  // 3) Candidatas por SKU para las unidades aún sin vínculo.
  const skusBuscados = [
    ...new Set(
      unidades
        .filter((u) => !vinculadas.has(clave(u.itemId, u.variationId)) && u.sku)
        .map((u) => u.sku as string),
    ),
  ];
  const porSku = new Map<string, FilaProducto[]>();
  for (let i = 0; i < skusBuscados.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("sku", skusBuscados.slice(i, i + 100))
      .is("meli_item_id", null);
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) {
      porSku.set(f.sku!, [...(porSku.get(f.sku!) ?? []), f]);
    }
  }

  const nuevos: Record<string, unknown>[] = [];
  const cambios: { id: string; fila: Record<string, unknown> }[] = [];
  const alinearML: FilaVinculada[] = []; // al vincular, el CRM manda → empujar a ML
  /* Publicaciones que se salieron del número del CRM y hay que devolver a él
     (solo para los productos donde el CRM manda). */
  const corregirDesdeCRM: FilaVinculada[] = [];
  const logs: EntradaStockLog[] = []; // adopción local del stock de ML, para el ledger
  const reclamadas = new Set<string>();
  let vinculados = 0;
  let gemelas = 0; // publicaciones colgadas de una ficha existente (catálogo de ML)

  /* Publicaciones a registrar. La `producto_id` de las filas nuevas todavía no
     existe, así que esas se resuelven después del insert (por eso la unidad se
     guarda aparte y se completa al final). */
  const publicaciones: Publicacion[] = [];
  const nuevoPorUnidadInv = new Set<string>(); // bodegas que ya reclamó una fila nueva de este lote
  const gemelasPendientes: UnidadML[] = []; // gemelas de esas filas nuevas
  /* Fichas vistas en este lote: solo a ellas se les recalcula el depósito de
     Mercado Full (una sync de un item suelto no debe tocar el resto). */
  const fichasDelLote = new Set<string>();
  /* Depósito de Mercado Full por ficha, indexado por unidad de INVENTARIO. Las
     publicaciones gemelas de catálogo comparten depósito: su cantidad es la
     MISMA, no una suma, así que se guarda por llave y no se acumula. */
  const fullPorFicha = new Map<string, Map<string, number>>();
  const anotarFull = (u: UnidadML, productoId: string) => {
    if (u.logisticType !== LOGISTICA_FULL) return;
    const depositos = fullPorFicha.get(productoId) ?? new Map<string, number>();
    depositos.set(u.userProductId ?? clave(u.itemId, u.variationId), u.stock);
    fullPorFicha.set(productoId, depositos);
  };
  const registrar = (u: UnidadML, productoId: string, principal: boolean) => {
    publicaciones.push({
      meli_item_id: u.itemId,
      meli_variation_id: u.variationId,
      producto_id: productoId,
      meli_user_product_id: u.userProductId,
      principal,
    });
    if (u.userProductId) productoPorUnidadInv.set(u.userProductId, productoId);
    fichasDelLote.add(productoId);
    anotarFull(u, productoId);
  };

  /* Las unidades que ya tienen ficha se procesan primero: así, cuando llega su
     gemela de catálogo, la bodega ya tiene dueño y la gemela se cuelga en vez de
     abrir una ficha nueva (el orden en que ML devuelve las publicaciones es
     arbitrario). */
  const enOrden = [...unidades].sort(
    (a, b) =>
      Number(vinculadas.has(clave(b.itemId, b.variationId))) -
      Number(vinculadas.has(clave(a.itemId, a.variationId))),
  );

  for (const u of enOrden) {
    const meliIds = { meli_item_id: u.itemId, meli_variation_id: u.variationId };
    const existente = vinculadas.get(clave(u.itemId, u.variationId));

    if (existente) {
      registrar(u, existente.id, true);
      /* Datos que son de la PUBLICACIÓN (no del catálogo de TN) y por eso se
         refrescan siempre: la unidad de inventario —lo que permite detectar dos
         fichas que son el mismo artículo— y la modalidad de envío. */
      const dePublicacion: Record<string, unknown> = {};
      if (u.userProductId && u.userProductId !== existente.meli_user_product_id) {
        dePublicacion.meli_user_product_id = u.userProductId;
      }
      if (u.logisticType !== existente.meli_logistic_type) {
        dePublicacion.meli_logistic_type = u.logisticType;
      }
      /* Solo si viene: un multiget sin permalink no debe borrar el guardado. */
      if (u.permalink && u.permalink !== existente.meli_permalink) {
        dePublicacion.meli_permalink = u.permalink;
      }

      /* Cuando el CRM manda este producto, Mercado Libre NO dicta su stock: solo
         se adopta catálogo. El stock baja por venta (descuento) o ajuste manual,
         nunca por la sync matutina.

         La decisión es POR PRODUCTO —igual que en la sync de Tienda Nube— para
         que durante el piloto solo los SKUs de la lista blanca cambien de modelo
         y las otras publicaciones sigan adoptando como siempre. En simulacro no
         cambia nada: ahí solo se observa. */
      const crmManda =
        HUB_VENTAS_ACTIVO && !esSimulacro() && puedeEscribir("mercadolibre", u.sku);

      /* Mercado Libre se salió del número del CRM: se le devuelve.

         Esto hay que mirarlo ANTES del atajo de Tienda Nube de abajo. Si no, un
         producto vinculado a los dos canales se saltaba entero y nadie vigilaba
         su publicación de ML: bastaba con que Tienda Nube coincidiera con el CRM
         para que una desviación de ML se quedara ahí para siempre. */
      if (crmManda && u.stock !== existente.stock) {
        corregirDesdeCRM.push({
          id: existente.id,
          sku: u.sku,
          tiendanube_product_id: existente.tiendanube_product_id,
          tiendanube_variant_id: existente.tiendanube_variant_id,
          meli_item_id: u.itemId,
          meli_variation_id: u.variationId,
          meli_logistic_type: u.logisticType,
          stock: existente.stock,
          delta: null, // corrección hacia la fuente de verdad, no un movimiento
        });
      }

      // Vinculada también a Tienda Nube → TN gobierna su catálogo (nombre,
      // variante, precio, activo). De Mercado Libre solo se refrescan los datos
      // de la publicación.
      if (existente.tiendanube_variant_id != null) {
        if (Object.keys(dePublicacion).length > 0) {
          cambios.push({ id: existente.id, fila: dePublicacion });
        }
        continue;
      }

      const stockCambio = !crmManda && u.stock !== existente.stock;
      const fila: Record<string, unknown> = {
        nombre: u.nombre,
        variante: u.variante,
        precio: u.precio,
        sku: u.sku,
        activo: u.activo,
        ...dePublicacion,
        ...fotos(u),
        ...(stockCambio ? { stock: u.stock } : {}),
      };
      cambios.push({ id: existente.id, fila });
      if (stockCambio) {
        logs.push({
          producto_id: existente.id,
          canal: "crm",
          origen: "mercadolibre_sync",
          stock_anterior: existente.stock,
          stock_nuevo: u.stock,
        });
      }
      continue;
    }

    /* Publicación GEMELA: no tiene fila propia porque su inventario ya lo
       representa otra ficha (típicamente la publicación que ML clonó para su
       catálogo, o la clonada si la fusión dejó como principal a la otra). Se
       vuelve a registrar el vínculo —así las ventas que entren por ella caen en
       la ficha correcta— y NO se toca el producto: lo gobierna su principal. */
    const yaPublicada = publicadas.get(clave(u.itemId, u.variationId));
    const dueno = yaPublicada?.producto_id ?? (u.userProductId ? productoPorUnidadInv.get(u.userProductId) : null);
    if (dueno) {
      registrar(u, dueno, false);
      gemelas++;
      continue;
    }
    /* Gemela cuya hermana TAMPOCO existía y se está creando en este mismo lote:
       la ficha aún no tiene id, así que se anota y se resuelve tras el insert. */
    if (u.userProductId && nuevoPorUnidadInv.has(u.userProductId)) {
      gemelasPendientes.push(u);
      gemelas++;
      continue;
    }

    const candidatas = (u.sku && porSku.get(u.sku)?.filter((f) => !reclamadas.has(f.id))) || [];
    if (candidatas.length === 1) {
      // Match único por SKU → vincular. En el momento de vincular, el stock
      // vigente del CRM (que viene de Tienda Nube) es la verdad: se conserva
      // y se alinea Mercado Libre hacia él si difiere.
      const fila = candidatas[0];
      reclamadas.add(fila.id);
      cambios.push({
        id: fila.id,
        fila: {
          ...meliIds,
          meli_logistic_type: u.logisticType,
          meli_user_product_id: u.userProductId,
          meli_permalink: u.permalink,
        },
      });
      registrar(u, fila.id, true);
      vinculados++;
      if (u.stock !== fila.stock) {
        /* Al vincular manda el CRM (su stock viene de Tienda Nube), así que aquí
           SÍ se impone el total: no es un movimiento, es una alineación inicial.
           Por eso va sin `delta`. */
        alinearML.push({ ...fila, ...meliIds, meli_logistic_type: u.logisticType });
      }
      continue;
    }

    // Sin SKU, sin match o SKU ambiguo (duplicado) → fila nueva.
    if (u.userProductId) nuevoPorUnidadInv.add(u.userProductId);
    nuevos.push({
      nombre: u.nombre,
      variante: u.variante,
      tipo: tipoDesdeProducto({ nombre: u.nombre, sku: u.sku }),
      precio: u.precio,
      sku: u.sku,
      stock: u.stock,
      activo: u.activo,
      meli_logistic_type: u.logisticType,
      meli_user_product_id: u.userProductId,
      meli_permalink: u.permalink,
      ...fotos(u),
      ...meliIds,
    });
  }

  if (nuevos.length > 0) {
    // `select` para conocer los ids recién creados y poder registrar su
    // publicación principal en meli_publicaciones.
    const { data, error } = await admin
      .from("products")
      .insert(nuevos)
      .select("id, meli_item_id, meli_variation_id, meli_user_product_id, meli_logistic_type, stock");
    if (error) throw new Error(error.message);
    for (const f of data ?? []) {
      publicaciones.push({
        meli_item_id: f.meli_item_id as string,
        meli_variation_id: (f.meli_variation_id as number | null) ?? null,
        producto_id: f.id as string,
        meli_user_product_id: (f.meli_user_product_id as string | null) ?? null,
        principal: true,
      });
      const up = f.meli_user_product_id as string | null;
      if (up) productoPorUnidadInv.set(up, f.id as string);
      fichasDelLote.add(f.id as string);
      /* Ficha nueva de una publicación Full: su `stock` ES el depósito de ML
         (no hay bodega detrás), y también se anota como Full para que el
         inventario lo muestre en su columna. */
      if (f.meli_logistic_type === LOGISTICA_FULL) {
        fullPorFicha.set(
          f.id as string,
          new Map([
            [
              (f.meli_user_product_id as string | null) ??
                clave(f.meli_item_id as string, (f.meli_variation_id as number | null) ?? null),
              (f.stock as number) ?? 0,
            ],
          ]),
        );
      }
    }
    // Ahora sí: las gemelas de esas filas recién creadas ya tienen a quién colgarse.
    for (const u of gemelasPendientes) {
      const productoId = u.userProductId ? productoPorUnidadInv.get(u.userProductId) : null;
      if (productoId) registrar(u, productoId, false);
    }
  }
  /* Los cambios se aplican en lote SOLO donde se tiene la ficha entera, que aquí
     son las publicaciones que no viven en Tienda Nube: de esas, Mercado Libre es
     dueño del catálogo y manda nombre, variante, precio, sku y estado.

     Los otros dos casos siguen fila por fila a propósito, y el helper los
     distingue solo: el de una ficha que TAMBIÉN está en Tienda Nube —donde solo
     se refresca el dato de la publicación (logística, unidad de inventario) y no
     se toca el catálogo, que gobierna TN— y el de vincular por SKU, que escribe
     únicamente los identificadores. Ninguno de los dos trae `nombre`, que es
     NOT NULL, así que un upsert los rechazaría; y "completarlos" con el nombre
     que ya está en la base sería devolverle a Mercado Libre el mando sobre un
     catálogo que no es suyo. En una sync normal son un puñado de filas. */
  await aplicarCambiosProductos(admin, cambios);

  /* Registro de publicaciones: el mapa que usa la importación de ventas para
     saber a qué ficha pertenece una orden, venga por la publicación original o
     por la gemela de catálogo. Se reescribe en cada sync (`unidad` es la llave),
     así que reasignaciones y fusiones quedan al día solas. */
  for (let i = 0; i < publicaciones.length; i += 200) {
    const { error } = await admin
      .from("meli_publicaciones")
      .upsert(publicaciones.slice(i, i + 200), { onConflict: "unidad" });
    if (error) console.error("[mercadolibre] registro de publicaciones:", error.message);
  }

  /* Depósito de Mercado Full. Va aparte del upsert de arriba porque una ficha
     puede recibirlo desde una publicación GEMELA, que no genera cambios en
     `products`. Solo se tocan las fichas de este lote: la sync de un item
     suelto no debe borrarle el Full a las demás. Se deja para el final —después
     del registro de publicaciones— para que, si la columna todavía no existe en
     la base, el fallo no se lleve por delante ese mapeo, que es el que decide a
     qué ficha pertenece cada venta. */
  await escribirStockFull(fichasDelLote, fullPorFicha);

  // Propagación (nunca rompe la sync a la base: solo se loggea), no-op mientras
  // la escritura a canales esté apagada (el default). Mercado Libre NUNCA
  // escribe stock en Tienda Nube; solo se alinea ML hacia el CRM al vincular
  // por SKU.
  try {
    if (alinearML.length > 0) {
      // Origen "tiendanube" = no reenviar a TN (el valor vigente ya es suyo);
      // solo alinear Mercado Libre.
      (await propagarStock("tiendanube", alinearML)).forEach((e) =>
        console.error("[stock-hub] vincular→ML:", e),
      );
    }
    if (corregirDesdeCRM.length > 0) {
      // El CRM manda: devuelve a su número las publicaciones que se desviaron.
      (await propagarStock("crm", corregirDesdeCRM)).forEach((e) =>
        console.error("[stock-hub] CRM→canales:", e),
      );
    }
  } catch (e) {
    console.error("[stock-hub] propagación:", e);
  }

  await registrarStockLog(logs);
  return { creados: nuevos.length, actualizados: cambios.length - vinculados, vinculados, gemelas };
}

/* Sync de un solo item (lo dispara la notificación de ML). */
export async function sincronizarItemML(itemId: string): Promise<void> {
  const cx = await conexionMercadolibre();
  if (!cx) return;
  const item = await obtenerItemML(cx, itemId);
  if (item) {
    await sincronizarItemsML([item]);
    return;
  }
  // Item eliminado: baja lógica solo de renglones que viven únicamente en ML
  // (los vinculados a Tienda Nube siguen gobernados por TN).
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ activo: false })
    .eq("meli_item_id", itemId)
    .is("tiendanube_variant_id", null);
  if (error) throw new Error(error.message);
}

/* Importación inicial y reconciliación (cron 6:30 UTC / botón manual). */
export async function importacionCompletaML(cx?: ConexionML): Promise<ResumenSyncML> {
  const conexion = cx ?? (await conexionMercadolibre());
  if (!conexion) throw new Error("Mercado Libre no está conectado.");

  const items = await listarItemsML(conexion);
  const resumenLote = await sincronizarItemsML(items);

  // Renglones solo-ML cuyo item ya no existe en el catálogo → inactivos.
  const admin = createAdminClient();
  const vivos = new Set(items.flatMap((i) => unidadesDe(i).map((u) => clave(u.itemId, u.variationId))));
  const { data: enBase, error } = await admin
    .from("products")
    .select("id, meli_item_id, meli_variation_id")
    .not("meli_item_id", "is", null)
    .is("tiendanube_variant_id", null)
    .eq("activo", true);
  if (error) throw new Error(error.message);
  const sobrantes = ((enBase ?? []) as FilaProducto[])
    .filter((f) => !vivos.has(clave(f.meli_item_id!, f.meli_variation_id)))
    .map((f) => f.id);
  if (sobrantes.length > 0) {
    const { error: errBaja } = await admin.from("products").update({ activo: false }).in("id", sobrantes);
    if (errBaja) throw new Error(errBaja.message);
  }

  const resumen: ResumenSyncML = { items: items.length, ...resumenLote, desactivados: sobrantes.length };

  // `datos` se escribe con merge para no perder nada más que viva ahí.
  await mezclarDatosIntegracion("mercadolibre", { ultima_sync: new Date().toISOString(), ...resumen });

  return resumen;
}
