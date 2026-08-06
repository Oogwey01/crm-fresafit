/* ============================================================================
   lib/inventario/foto-canales.ts — Foto horaria del stock en cada canal
   ----------------------------------------------------------------------------
   `stock_log` cuenta lo que hace el CRM. Esto cuenta lo que le PASA al
   inventario, lo mueva quien lo mueva: Astroselling, un ajuste en el panel de
   Tienda Nube, una venta que el canal descuenta por su cuenta o el propio CRM.

   Cada corrida lee el stock en vivo de los tres lados, guarda el último valor
   observado (`stock_canal`) y registra un renglón en `stock_canal_log` SOLO si
   algún número cambió respecto a la foto anterior. Guardar diferencias y no
   fotos completas mantiene la tabla pequeña: 600 productos × 24 corridas al día
   serían 14 mil filas diarias de las que casi ninguna aporta algo.

   Es SOLO LECTURA frente a los canales: observa, no corrige. Lo único que
   aporta hacia la corrección es la lista de desviaciones ESTABLES —las que ya
   estaban en la foto anterior con los mismos números—, que es la materia prima
   de lib/inventario/reparacion.ts. La estabilidad importa: un descuadre que se
   mueve entre dos fotos suele ser una venta en vuelo que se resolverá sola, y
   corregirla sería borrarla.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/tipos-bd";
import { porLotes, TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";
import { leerCanales, stockEnCanales } from "@/lib/inventario/reconciliacion";

export type ResumenFoto = {
  productos: number; // productos observados
  cambios: number; // los que se movieron desde la foto anterior
  nuevos: number; // vistos por primera vez (no cuentan como cambio)
  /* Descuadres que llevan al menos dos fotos quietos con los mismos números. */
  estables: DesviacionEstable[];
};

/* Un producto cuyo stock NO coincide con algún canal, y que además lleva dos
   lecturas consecutivas sin que ninguno de los tres números se mueva. */
export type DesviacionEstable = {
  producto_id: string;
  stock_crm: number;
  stock_tn: number | null;
  stock_ml: number | null;
};

type FilaCanal = {
  producto_id: string;
  stock_crm: number | null;
  stock_tn: number | null;
  stock_ml: number | null;
};

export async function tomarFotoCanales(): Promise<ResumenFoto> {
  const admin = createAdminClient();
  const lectura = await leerCanales();

  // Foto anterior, para comparar. Una fila por producto, así que cabe entera.
  const previas = new Map<string, FilaCanal>();
  const TAM = 1000;
  for (let desde = 0; ; desde += TAM) {
    const { data, error } = await admin
      .from("stock_canal")
      .select("producto_id, stock_crm, stock_tn, stock_ml")
      .range(desde, desde + TAM - 1);
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaCanal[]) previas.set(f.producto_id, f);
    if ((data ?? []).length < TAM) break;
  }

  const ahora = new Date().toISOString();
  const actuales: (FilaCanal & { visto_en: string })[] = [];
  const cambios: TablesInsert<"stock_canal_log">[] = [];
  const estables: DesviacionEstable[] = [];
  let nuevos = 0;

  for (const f of lectura.filas) {
    const { tn, ml } = stockEnCanales(f, lectura);
    const actual: FilaCanal = { producto_id: f.id, stock_crm: f.stock, stock_tn: tn, stock_ml: ml };
    actuales.push({ ...actual, visto_en: ahora });

    const previa = previas.get(f.id);
    if (!previa) {
      nuevos++;
      continue;
    }
    /* Un canal que hoy devuelve null (desconectado, publicación caída) no es un
       cambio: es falta de dato. Solo se compara lo que se pudo leer. */
    const movio = (a: number | null, b: number | null) => a !== null && b !== null && a !== b;
    const quieto =
      previa.stock_crm === actual.stock_crm &&
      previa.stock_tn === actual.stock_tn &&
      previa.stock_ml === actual.stock_ml;
    const descuadrado =
      actual.stock_crm !== null &&
      ((actual.stock_tn !== null && actual.stock_tn !== actual.stock_crm) ||
        (actual.stock_ml !== null && actual.stock_ml !== actual.stock_crm));
    /* Quieto Y descuadrado: nada se movió entre las dos lecturas y aun así los
       números no coinciden. Eso ya no es una venta en tránsito. */
    if (quieto && descuadrado) {
      estables.push({
        producto_id: f.id,
        stock_crm: actual.stock_crm!,
        stock_tn: actual.stock_tn,
        stock_ml: actual.stock_ml,
      });
    }
    if (
      movio(previa.stock_crm, actual.stock_crm) ||
      movio(previa.stock_tn, actual.stock_tn) ||
      movio(previa.stock_ml, actual.stock_ml)
    ) {
      cambios.push({
        producto_id: f.id,
        stock_crm_ant: previa.stock_crm,
        stock_crm: actual.stock_crm,
        stock_tn_ant: previa.stock_tn,
        stock_tn: actual.stock_tn,
        stock_ml_ant: previa.stock_ml,
        stock_ml: actual.stock_ml,
        detectado_en: ahora,
      });
    }
  }

  /* La foto y su bitácora no dependen la una de la otra, y cada una va en
     tandas paralelas: eran dos bucles secuenciales, uno detrás del otro. */
  await Promise.all([
    porLotes(actuales, TAM_LOTE_UPSERT, async (tanda) => {
      const { error } = await admin
        .from("stock_canal")
        .upsert(tanda, { onConflict: "producto_id" });
      if (error) throw new Error(error.message);
    }),
    porLotes(cambios, TAM_LOTE_UPSERT, async (tanda) => {
      const { error } = await admin.from("stock_canal_log").insert(tanda);
      if (error) throw new Error(error.message);
    }),
  ]);

  return { productos: actuales.length, cambios: cambios.length, nuevos, estables };
}
