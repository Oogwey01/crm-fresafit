/* ============================================================================
   lib/inventario/duplicados-ml.ts — Fichas que son el mismo artículo
   ----------------------------------------------------------------------------
   Dos formas distintas de terminar con la misma pieza en dos fichas:

   1. BODEGA COMPARTIDA EN ML (`user_product_id`). Al sumar un artículo a su
      catálogo, Mercado Libre crea una publicación gemela que comparte bodega
      con la original. El CRM las importó como fichas separadas.

   2. MISMO SKU EN DOS CANALES. Una publicación de ML entró sin SKU (o con el de
      otra herramienta) y se le abrió ficha propia; cuando después le cargan el
      SKU correcto, esa ficha y la de Tienda Nube pasan a ser el mismo producto.
      La sync no las une sola: el emparejamiento por SKU solo corre para
      publicaciones que aún NO tienen ficha, y ésta ya tiene la suya.

   En ambos casos, mientras estén separadas el inventario se cuenta doble y las
   ventas se reparten. Aquí se DETECTAN (solo lectura). Unirlas es una acción
   explícita del panel de Reconciliación: fusionarProductosML → RPC
   fusionar_producto_ml.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
import type { ItemML } from "@/lib/mercadolibre/api";
import { unidadesDe } from "@/lib/mercadolibre/sync";

export type FichaDuplicada = {
  id: string;
  nombre: string;
  sku: string | null;
  stock: number;
  activo: boolean;
  meli_item_id: string | null;
  en_tiendanube: boolean;
  ventas: number;
};

/* Por qué el CRM cree que estas fichas son la misma pieza. */
export type MotivoDuplicado = "bodega_ml" | "sku";

export type GrupoDuplicado = {
  /* Identidad del grupo: el artículo de ML ("MLMU…") o "sku:XXX". */
  clave: string;
  motivo: MotivoDuplicado;
  /* Artículo del vendedor en ML ("MLMU…"): la bodega que comparten. Solo en los
     grupos por bodega. */
  user_product_id: string | null;
  /* Lo que ML reporta para esa bodega (las publicaciones siempre coinciden). */
  stock_ml: number | null;
  fichas: FichaDuplicada[];
  /* Ficha que debería quedarse: la vinculada a Tienda Nube, porque TN es el
     padre del inventario. null = no hay una obvia (ninguna o varias vinculadas)
     y conviene revisarlo a mano antes de unir. */
  ganador_id: string | null;
};

type FilaCRM = {
  id: string;
  nombre: string;
  sku: string | null;
  stock: number;
  activo: boolean;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
};

/* Recibe el catálogo de ML ya leído (lo trae la reconciliación) para no pedirlo
   dos veces. Sin items → sin grupos. */
export async function detectarDuplicadosML(itemsML: ItemML[] | null): Promise<GrupoDuplicado[]> {
  if (!itemsML?.length) return [];
  const admin = createAdminClient();

  // Publicaciones agrupadas por la bodega que comparten.
  const porUnidadInv = new Map<string, ItemML[]>();
  for (const item of itemsML) {
    const up = item.user_product_id;
    if (!up) continue; // publicaciones viejas sin artículo de vendedor
    porUnidadInv.set(up, [...(porUnidadInv.get(up) ?? []), item]);
  }
  const compartidas = [...porUnidadInv.entries()].filter(([, items]) => items.length > 1);
  if (compartidas.length === 0) return [];

  /* Fichas del CRM de esas publicaciones. Se incluyen las INACTIVAS: el
     duplicado existe igual y hay que unirlo (la publicación gemela suele quedar
     activa mientras la original está pausada). */
  const itemIds = compartidas.flatMap(([, items]) => items.map((i) => i.id));
  const filas = new Map<string, FilaCRM>(); // meli_item_id → fila
  for (let i = 0; i < itemIds.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select("id, nombre, sku, stock, activo, tiendanube_variant_id, meli_item_id")
      .in("meli_item_id", itemIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaCRM[]) filas.set(f.meli_item_id!, f);
  }

  const ventas = await ventasPorFicha([...new Set([...filas.values()].map((f) => f.id))]);

  const grupos: GrupoDuplicado[] = [];
  for (const [userProductId, items] of compartidas) {
    // Fichas distintas del grupo (dos publicaciones pueden apuntar ya a la misma).
    const delGrupo = new Map<string, FichaDuplicada>();
    for (const item of items) {
      const f = filas.get(item.id);
      if (!f || delGrupo.has(f.id)) continue;
      delGrupo.set(f.id, ficha(f, ventas));
    }
    if (delGrupo.size < 2) continue; // ya está unificado

    const fichas = [...delGrupo.values()];
    const enTN = fichas.filter((f) => f.en_tiendanube);
    grupos.push({
      clave: userProductId,
      motivo: "bodega_ml",
      user_product_id: userProductId,
      stock_ml: unidadesDe(items[0])[0]?.stock ?? null,
      fichas,
      ganador_id: enTN.length === 1 ? enTN[0].id : null,
    });
  }

  return ordenar(grupos);
}

/* ----------------------------------------------------------------------------
   Mismo SKU en dos fichas (Tienda Nube + una publicación suelta de ML)
   -------------------------------------------------------------------------- */

/* Se piden los grupos donde conviven una ficha de Tienda Nube y otra que solo
   vive en Mercado Libre con el MISMO SKU. Es el rastro que deja corregir el SKU
   en ML después de que el CRM ya le había abierto ficha propia.

   `yaCubiertas` son las fichas que otro criterio (bodega compartida) ya está
   ofreciendo unir: no tiene sentido listarlas dos veces.

   No se agrupan fichas que sean AMBAS de Tienda Nube: dos variantes de TN con el
   mismo SKU es un error de captura en la tienda, no un duplicado que el CRM
   deba fusionar. */
export async function detectarDuplicadosPorSku(
  yaCubiertas: Set<string> = new Set(),
): Promise<GrupoDuplicado[]> {
  const admin = createAdminClient();
  const conML = await traerTodo<FilaCRM>((desde, hasta) =>
    admin
      .from("products")
      .select("id, nombre, sku, stock, activo, tiendanube_variant_id, meli_item_id")
      .not("sku", "is", null)
      .not("meli_item_id", "is", null)
      .range(desde, hasta),
  );
  const soloML = conML.filter((f) => f.tiendanube_variant_id == null);
  if (soloML.length === 0) return [];

  // Contraparte: las fichas de Tienda Nube con esos mismos SKU.
  const skus = [...new Set(soloML.map((f) => f.sku!.trim()))];
  const deTN: FilaCRM[] = [];
  for (let i = 0; i < skus.length; i += 100) {
    const { data: tn, error: errTN } = await admin
      .from("products")
      .select("id, nombre, sku, stock, activo, tiendanube_variant_id, meli_item_id")
      .in("sku", skus.slice(i, i + 100))
      .not("tiendanube_variant_id", "is", null);
    if (errTN) throw new Error(errTN.message);
    deTN.push(...((tn ?? []) as FilaCRM[]));
  }
  if (deTN.length === 0) return [];

  const porSku = new Map<string, { tn: FilaCRM[]; ml: FilaCRM[] }>();
  const bolsa = (sku: string) => {
    const k = sku.trim();
    if (!porSku.has(k)) porSku.set(k, { tn: [], ml: [] });
    return porSku.get(k)!;
  };
  for (const f of deTN) bolsa(f.sku!).tn.push(f);
  for (const f of soloML) bolsa(f.sku!).ml.push(f);

  const candidatas = [...porSku.entries()].filter(
    ([, b]) => b.tn.length > 0 && b.ml.length > 0 && [...b.tn, ...b.ml].some((f) => !yaCubiertas.has(f.id)),
  );
  if (candidatas.length === 0) return [];

  const ventas = await ventasPorFicha(candidatas.flatMap(([, b]) => [...b.tn, ...b.ml].map((f) => f.id)));

  const grupos: GrupoDuplicado[] = [];
  for (const [sku, b] of candidatas) {
    const fichas = [...b.tn, ...b.ml].map((f) => ficha(f, ventas));
    grupos.push({
      clave: `sku:${sku}`,
      motivo: "sku",
      user_product_id: null,
      stock_ml: null,
      fichas,
      // Con varias fichas de TN compartiendo SKU no hay una obvia: lo decide quien revisa.
      ganador_id: b.tn.length === 1 ? b.tn[0].id : null,
    });
  }
  return ordenar(grupos);
}

/* ----------------------------------- Comunes ------------------------------ */

function ficha(f: FilaCRM, ventas: Map<string, number>): FichaDuplicada {
  return {
    id: f.id,
    nombre: f.nombre,
    sku: f.sku,
    stock: f.stock,
    activo: f.activo,
    meli_item_id: f.meli_item_id,
    en_tiendanube: f.tiendanube_variant_id != null,
    ventas: ventas.get(f.id) ?? 0,
  };
}

/* Ventas por ficha: es el historial que la fusión va a mover, así que se muestra
   para que quien decide sepa qué está en juego. */
async function ventasPorFicha(ids: string[]): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return new Map();

  /* Un `group by` en la base: una consulta que devuelve un renglón por ficha.
     Antes era un conteo por ficha lanzado en paralelo, con el argumento de que
     las duplicadas son pocas —cierto— y de que así no viajaba ninguna fila
     —también cierto—. Pero agrupar tampoco baja filas y además no depende de
     que sigan siendo pocas: el día que un canal duplique medio catálogo, esto
     sigue costando una consulta. */
  const { data, error } = await admin.rpc("conteo_ventas_por_producto", { ids: unicos });
  if (error) throw new Error(error.message);

  return new Map(
    ((data ?? []) as { producto_id: string; ventas: number }[]).map((f) => [
      f.producto_id,
      Number(f.ventas),
    ]),
  );
}

/* Primero los que se pueden unir sin pensarlo, y dentro de esos los que más
   historial mueven. */
function ordenar(grupos: GrupoDuplicado[]): GrupoDuplicado[] {
  return grupos.sort((a, b) => {
    if (!!a.ganador_id !== !!b.ganador_id) return a.ganador_id ? -1 : 1;
    const vA = a.fichas.reduce((s, f) => s + f.ventas, 0);
    const vB = b.fichas.reduce((s, f) => s + f.ventas, 0);
    return vB - vA;
  });
}
