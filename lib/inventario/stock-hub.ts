/* ============================================================================
   lib/inventario/stock-hub.ts — Propagación de stock multicanal
   ----------------------------------------------------------------------------
   El CRM es el hub del stock: un cambio que entra por un canal (o por el propio
   CRM) se reenvía a los demás canales vinculados.

   La versión anterior mandaba el RESULTADO ("pon 487") con el número que el CRM
   tenía guardado. Eso se pisa con cualquier otro escritor: el 18/07 mandó a
   Tienda Nube un stock de tres días antes y borró 27 unidades de movimientos —
   una venta de la tienda, una de Mercado Libre y una salida de 25 a TikTok.

   Ahora, antes de cada escritura:

     1. ¿Está permitido? (canal habilitado + lista blanca de SKUs del piloto)
     2. ¿Tiene sentido? (Mercado Full vive en otro almacén; los combos de Tienda
        Nube no llevan control de stock; una publicación borrada no se toca)
     3. Se LEE el stock que el canal tiene ahora mismo.
     4. Si ya coincide, no se escribe — eso corta el eco de vuelta.
     5. Si difiere y sabemos qué movimiento lo causó, se aplica ESE movimiento
        sobre el valor real del canal. Si no lo sabemos, se manda el absoluto.
     6. Un salto mayor a LIMITE_CORDURA no se escribe: se reporta. El "+27"
        habría muerto aquí.

   Todo bajo un candado por producto, porque el webhook, el cron y la
   importación de ventas pueden tocar el mismo artículo a la vez.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { actualizarVarianteTN, conexionTiendanube, stockVarianteTN } from "@/lib/tiendanube/api";
import {
  actualizarStockML,
  conexionMercadolibre,
  stockActualML,
  LOGISTICA_FULL,
} from "@/lib/mercadolibre/api";
import { actualizarStockTikTok, conexionTiktok, stockActualTikTok } from "@/lib/tiktok/api";
import { registrarStockLog, type EntradaStockLog } from "@/lib/inventario/stock-log";
import {
  esSimulacro,
  modoEscritura,
  puedeEscribir,
  type CanalEscritura,
} from "@/lib/inventario/escritura-canales";
import { SLUG_A_CANAL_VENTA, type OrigenStock } from "@/lib/canales/tipos";

export type { OrigenStock };

/* Etiqueta de `origen` para el ledger según el canal que disparó el empuje. */
const ORIGEN_LOG: Record<OrigenStock, string> = {
  crm: "manual",
  tiendanube: "tiendanube_sync",
  mercadolibre: "mercadolibre_sync",
  tiktok: "tiktok_sync",
};

/* Salto máximo que el hub aplica sin intervención humana. Las ventas mueven de
   a una o dos unidades; un salto de decenas es casi siempre un número viejo o
   un error de mapeo, no inventario real. Se reporta en vez de escribirse. */
export const LIMITE_CORDURA = 10;

/* Cuánto vale una escritura nuestra como "eco": si el canal nos avisa de un
   cambio que somos nosotros mismos, dentro de esta ventana no se re-propaga.
   Astroselling replicaba en ~32 segundos; dos minutos deja margen de sobra. */
const VENTANA_ECO_MS = 2 * 60 * 1000;

const SEGUNDOS_CANDADO = 30;

export type FilaVinculada = {
  id?: string | null; // id del producto en el CRM (para el ledger y el candado)
  sku?: string | null; // para la lista blanca de SKUs del piloto
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
  /* "fulfillment" = Mercado Full: el stock vive en un centro de ML y no se
     escribe desde aquí. */
  meli_logistic_type?: string | null;
  /* Producto bajo pedido (personalizados, bundles): no lleva control de stock.
     En Mercado Libre está publicado con 1000 unidades a propósito; escribirle
     un número lo rompería. Nunca se le empuja stock a ningún canal. */
  bajo_pedido?: boolean | null;
  // TikTok (fase 2): el hub ya acepta estos campos; el empuje aún no existe.
  tiktok_product_id?: string | null;
  tiktok_sku_id?: string | null;
  /* Stock del CRM DESPUÉS del cambio. */
  stock: number;
  /* El movimiento que lo produjo: −1 por una venta, +5 por un ajuste. Cuando
     viene, el hub lo aplica sobre lo que el canal tenga de verdad, en vez de
     imponer un resultado calculado con datos que pueden estar viejos. */
  delta?: number | null;
};

/* Empuja el stock de cada fila a los canales vinculados distintos del origen.
   No lanza: devuelve la lista de avisos (errores y escrituras frenadas) para
   que el llamador decida si mostrarlos o solo registrarlos. */
export async function propagarStock(
  origen: OrigenStock,
  filas: FilaVinculada[],
  /* Etiqueta para el ledger cuando se sabe qué causó el empuje. Sin ella se usa
     el canal de origen ("mercadolibre_sync"), que en una venta despista: el
     monitor diría "sync ML" para algo que fue una venta. */
  motivo?: string,
): Promise<string[]> {
  if (modoEscritura() === "off" || filas.length === 0) return [];

  const avisos: string[] = [];
  const logs: EntradaStockLog[] = [];
  const simulado = esSimulacro();

  /* Una fila por producto: si dos apuntan al mismo artículo, escribir dos veces
     es pedirle al canal que se contradiga. */
  const vistos = new Set<string>();
  const unicas = filas.filter((f) => {
    const k = f.id ?? `${f.tiendanube_variant_id}:${f.meli_item_id}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  const cxTN = origen !== "tiendanube" && unicas.some((f) => destinoTN(f)) ? await conexion(conexionTiendanube, "Tienda Nube", avisos) : null;
  const cxML = origen !== "mercadolibre" && unicas.some((f) => destinoML(f)) ? await conexion(conexionMercadolibre, "Mercado Libre", avisos) : null;
  const cxTikTok = origen !== "tiktok" && unicas.some((f) => destinoTikTok(f)) ? await conexion(conexionTiktok, "TikTok Shop", avisos) : null;

  for (const f of unicas) {
    const liberar = await tomarCandado(f.id);
    if (liberar === null) {
      avisos.push(`${etiqueta(f)}: otro proceso está actualizando su stock; se omite esta vez.`);
      continue;
    }
    try {
      if (cxTN && destinoTN(f)) {
        await empujar({
          canal: "tiendanube",
          fila: f,
          origen,
          motivo,
          simulado,
          avisos,
          logs,
          leer: () => stockVarianteTN(cxTN, f.tiendanube_product_id!, f.tiendanube_variant_id!),
          escribir: (valor) =>
            actualizarVarianteTN(cxTN, f.tiendanube_product_id!, f.tiendanube_variant_id!, {
              stock: valor,
            }),
        });
      }
      if (cxML && destinoML(f)) {
        await empujar({
          canal: "mercadolibre",
          fila: f,
          origen,
          motivo,
          simulado,
          avisos,
          logs,
          leer: () => stockActualML(cxML, f.meli_item_id!, f.meli_variation_id),
          escribir: (valor) => actualizarStockML(cxML, f.meli_item_id!, f.meli_variation_id, valor),
        });
      }
      if (cxTikTok && destinoTikTok(f)) {
        await empujar({
          canal: "tiktok",
          fila: f,
          origen,
          motivo,
          simulado,
          avisos,
          logs,
          leer: () => stockActualTikTok(cxTikTok, f.tiktok_product_id!, f.tiktok_sku_id!),
          escribir: (valor) => actualizarStockTikTok(cxTikTok, f.tiktok_product_id!, f.tiktok_sku_id!, valor),
        });
      }
    } finally {
      await liberar();
    }
  }

  await registrarStockLog(logs);
  return avisos;
}

/* ¿La fila tiene destino en cada canal, y está permitido tocarlo? */
function destinoTN(f: FilaVinculada): boolean {
  if (f.bajo_pedido) return false; // sin control de stock: no se le escribe
  return (
    f.tiendanube_product_id != null &&
    f.tiendanube_variant_id != null &&
    puedeEscribir("tiendanube", f.sku)
  );
}

function destinoML(f: FilaVinculada): boolean {
  if (f.bajo_pedido) return false; // publicado con 1000 unidades a propósito
  // Mercado Full: la mercancía está en un centro de ML; su stock no se dicta
  // desde la bodega.
  if (f.meli_logistic_type === LOGISTICA_FULL) return false;
  return f.meli_item_id != null && puedeEscribir("mercadolibre", f.sku);
}

function destinoTikTok(f: FilaVinculada): boolean {
  if (f.bajo_pedido) return false; // sin control de stock: no se le escribe
  return (
    f.tiktok_product_id != null && f.tiktok_sku_id != null && puedeEscribir("tiktok", f.sku)
  );
}

type Empuje = {
  canal: CanalEscritura;
  fila: FilaVinculada;
  origen: OrigenStock;
  /* Qué causó el empuje, para el ledger. Cae al canal de origen si no se sabe. */
  motivo?: string;
  simulado: boolean;
  avisos: string[];
  logs: EntradaStockLog[];
  /* undefined = la publicación/variante ya no existe; null (solo TN) = existe
     pero sin control de stock. */
  leer: () => Promise<number | null | undefined>;
  escribir: (valor: number) => Promise<void>;
};

const NOMBRE_CANAL: Record<CanalEscritura, string> = {
  tiendanube: "Tienda Nube",
  mercadolibre: "Mercado Libre",
  tiktok: "TikTok Shop",
};

/* El nombre que lleva el canal en los ledgers es el de venta, no el slug. */
const CANAL_LOG = SLUG_A_CANAL_VENTA;

async function empujar(e: Empuje): Promise<void> {
  const { canal, fila, avisos } = e;
  const nombre = NOMBRE_CANAL[canal];
  try {
    const actual = await e.leer();

    if (actual === undefined) {
      avisos.push(`${nombre}: ${etiqueta(fila)} ya no está en el canal; no se escribió.`);
      return;
    }
    if (actual === null) {
      // Combos, bundles y personalizados: en Tienda Nube no llevan inventario.
      // Escribirles un número los convertiría en productos con stock.
      return;
    }

    /* Objetivo: por defecto el CRM manda su valor (es la fuente de verdad). Pero
       si sabemos qué movimiento hubo (delta) y el canal NO está donde ese
       movimiento esperaba, es que alguien más lo tocó en medio: entonces se
       preserva su cambio y se le SUMA el nuestro, en vez de imponer el total del
       CRM (que borraría lo ajeno). Esto es "aplicar el movimiento, no el
       resultado" — la defensa que habría evitado el borrado de 27 unidades. */
    const conDelta = fila.delta != null && fila.delta !== 0;
    const esperadoAntes = conDelta ? fila.stock - fila.delta! : actual;
    const objetivo =
      conDelta && actual !== esperadoAntes ? Math.max(0, actual + fila.delta!) : fila.stock;

    // Ya está donde debe: no escribir. Aquí muere el eco de vuelta.
    if (objetivo === actual) return;

    if (Math.abs(objetivo - actual) > LIMITE_CORDURA) {
      avisos.push(
        `${nombre}: ${etiqueta(fila)} pedía pasar de ${actual} a ${objetivo} (${objetivo - actual > 0 ? "+" : ""}${objetivo - actual}). Es un salto demasiado grande para aplicarlo solo; revísalo a mano.`,
      );
      return;
    }

    if (await escrituraReciente(fila.id, CANAL_LOG[canal], objetivo)) return;

    if (!e.simulado) await e.escribir(objetivo);

    e.logs.push({
      producto_id: fila.id ?? null,
      canal: CANAL_LOG[canal],
      origen: e.motivo ?? ORIGEN_LOG[e.origen],
      stock_anterior: actual, // el valor REAL del canal, no lo que el CRM creía
      stock_nuevo: objetivo,
      simulado: e.simulado,
    });

    /* Cerrar el bucle: releer y confirmar que quedó lo que pedimos. Si no,
       NO se reintenta —reintentar a ciegas es como se amplifican estos ecos—:
       se avisa para que alguien lo mire. Cuesta un GET y solo ocurre cuando de
       verdad hubo escritura, que es poco frecuente. */
    if (!e.simulado) {
      const quedo = await e.leer();
      if (quedo !== objetivo) {
        avisos.push(
          `${nombre}: ${etiqueta(fila)} se escribió ${objetivo} pero el canal quedó en ${quedo ?? "sin dato"}. No se reintenta; revísalo.`,
        );
      }
    }
  } catch (err) {
    avisos.push(`${nombre}: ${mensaje(err)}`);
  }
}

/* ¿Ya escribimos ese mismo valor en ese canal hace un momento? Entonces esto es
   nuestro propio eco volviendo por el webhook del canal, y repetirlo solo
   alimenta el rebote. */
async function escrituraReciente(
  productoId: string | null | undefined,
  canal: string,
  valor: number,
): Promise<boolean> {
  if (!productoId) return false;
  try {
    const admin = createAdminClient();
    const desde = new Date(Date.now() - VENTANA_ECO_MS).toISOString();
    const { data } = await admin
      .from("stock_log")
      .select("id")
      .eq("producto_id", productoId)
      .eq("canal", canal)
      .eq("stock_nuevo", valor)
      .gte("creado_en", desde)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false; // ante la duda, escribir: el candado y el límite ya protegen
  }
}

/* Candado cooperativo por producto. Devuelve la función para liberarlo, o null
   si otro proceso lo tiene tomado. Sin id de producto no hay nada que
   serializar (no debería pasar, pero no es motivo para no escribir).

   ESPERA antes de rendirse. La primera versión se rendía al instante y eso hacía
   que un empuje se perdiera entero —los dos canales de un golpe, porque el
   candado envuelve a ambos—, sin más rastro que un aviso que es fácil no ver.
   Una operación de stock dura un par de segundos, así que reintentar un momento
   convierte un choque en una espera corta en vez de en un cambio perdido. */
const INTENTOS_CANDADO = 4;
const ESPERA_CANDADO_MS = 900;

async function tomarCandado(
  productoId: string | null | undefined,
): Promise<(() => Promise<void>) | null> {
  if (!productoId) return async () => {};
  try {
    const admin = createAdminClient();
    let tomado = false;
    for (let intento = 0; intento < INTENTOS_CANDADO && !tomado; intento++) {
      if (intento > 0) await new Promise((r) => setTimeout(r, ESPERA_CANDADO_MS));
      const { data, error } = await admin.rpc("tomar_candado_stock", {
        p_producto: productoId,
        p_segundos: SEGUNDOS_CANDADO,
      });
      if (error) throw new Error(error.message);
      tomado = data === true;
    }
    if (!tomado) return null;
    return async () => {
      try {
        await admin.rpc("liberar_candado_stock", { p_producto: productoId });
      } catch (e) {
        // Si no se pudo liberar, el vencimiento lo suelta solo en 30 s.
        console.error("[stock-hub] liberar candado:", e);
      }
    };
  } catch (e) {
    console.error("[stock-hub] candado:", e);
    return async () => {}; // la maquinaria del candado no debe frenar el negocio
  }
}

async function conexion<T>(
  obtener: () => Promise<T | null>,
  nombre: string,
  avisos: string[],
): Promise<T | null> {
  try {
    return await obtener();
  } catch (e) {
    avisos.push(`${nombre}: ${mensaje(e)}`);
    return null;
  }
}

function etiqueta(f: FilaVinculada): string {
  return f.sku?.trim() || f.meli_item_id || String(f.tiendanube_variant_id ?? "producto");
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : "error desconocido";
}
