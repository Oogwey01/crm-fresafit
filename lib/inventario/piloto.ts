/* ============================================================================
   lib/inventario/piloto.ts — Estado del piloto de escritura a canales
   ----------------------------------------------------------------------------
   Mientras el CRM toma el mando del stock producto por producto, hace falta ver
   de un vistazo si va bien: qué SKUs están dentro, si los tres canales coinciden
   y qué ha escrito el CRM últimamente.

   Se arma con datos que YA están en la base —la foto horaria (`stock_canal`) y
   el ledger (`stock_log`)— así que no cuesta ninguna llamada a las APIs de los
   canales y la pantalla abre al instante.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  canalesHabilitados,
  modoEscritura,
  skusHabilitados,
  type ModoEscritura,
} from "@/lib/inventario/escritura-canales";
import { HUB_VENTAS_ACTIVO } from "@/lib/inventario/hub-config";

export type FilaPiloto = {
  id: string;
  sku: string | null;
  nombre: string;
  stock_crm: number;
  /* De la última foto horaria; null = sin dato para ese canal. */
  stock_tn: number | null;
  stock_ml: number | null;
  visto_en: string | null;
  cuadrado: boolean;
};

export type MovimientoPiloto = {
  id: number;
  sku: string | null;
  canal: string;
  origen: string;
  stock_anterior: number | null;
  stock_nuevo: number;
  simulado: boolean;
  creado_en: string;
};

export type EstadoPiloto = {
  /* Hay algo que mostrar: el hub está activo o hay canales habilitados. */
  activo: boolean;
  modo: ModoEscritura;
  hubVentas: boolean;
  canales: string[];
  /* Vacío = el piloto abarca TODO el catálogo (el corte final). */
  skus: string[];
  filas: FilaPiloto[];
  movimientos: MovimientoPiloto[];
};

export async function estadoPiloto(): Promise<EstadoPiloto> {
  const modo = modoEscritura();
  const canales = [...canalesHabilitados()];
  const skus = [...skusHabilitados()];
  const base = { modo, hubVentas: HUB_VENTAS_ACTIVO, canales, skus };

  // Nada encendido: no hay piloto que mostrar.
  if (modo === "off" && !HUB_VENTAS_ACTIVO) {
    return { ...base, activo: false, filas: [], movimientos: [] };
  }

  const admin = createAdminClient();

  /* Los movimientos salientes no dependen de nada de lo demás, y la lista de
     productos solo de `skus`: se leen en paralelo. Las queries de stock_canal y
     stock_log de la tabla sí esperan, porque necesitan los ids de productos. */
  const [{ data: productos }, { data: movs }] = await Promise.all([
    skus.length > 0
      ? admin.from("products").select("id, sku, nombre, stock").in("sku", skus)
      : Promise.resolve({ data: null }),
    admin
      .from("stock_log")
      .select("id, producto_id, canal, origen, stock_anterior, stock_nuevo, simulado, creado_en, producto:products!producto_id(sku)")
      .neq("canal", "crm")
      .order("creado_en", { ascending: false })
      .limit(30),
  ]);

  /* Sin lista de SKUs el piloto es todo el catálogo: listar 600 productos aquí
     no ayudaría a nadie, así que la tabla se deja vacía y la pantalla muestra
     solo la configuración y los movimientos. */
  let filas: FilaPiloto[] = [];
  if (skus.length > 0) {
    const ids = (productos ?? []).map((p) => p.id as string);
    const fotos = new Map<string, { stock_tn: number | null; stock_ml: number | null; visto_en: string }>();
    const escrituras = new Map<string, { tn?: number; ml?: number; en: string }>();
    if (ids.length > 0) {
      /* Ambas dependen solo de `ids`: en paralelo. El armado de `escrituras`
         sí lee `fotos`, por eso se procesa después de llenarlas. */
      const [{ data: sc }, { data: sl }] = await Promise.all([
        admin
          .from("stock_canal")
          .select("producto_id, stock_tn, stock_ml, visto_en")
          .in("producto_id", ids),
        admin
          .from("stock_log")
          .select("producto_id, canal, stock_nuevo, creado_en")
          .in("producto_id", ids)
          .neq("canal", "crm")
          .eq("simulado", false)
          .order("creado_en", { ascending: true }),
      ]);
      for (const f of sc ?? []) {
        fotos.set(f.producto_id as string, {
          stock_tn: f.stock_tn as number | null,
          stock_ml: f.stock_ml as number | null,
          visto_en: f.visto_en as string,
        });
      }

      /* La foto es horaria, así que puede ser más vieja que la última escritura
         del CRM. Cuando el ledger registra un empuje POSTERIOR a la foto, ese
         valor es el más fresco que conocemos: si no, el monitor marcaría en rojo
         una desviación que el propio CRM ya corrigió. */
      for (const e of sl ?? []) {
        const id = e.producto_id as string;
        const foto = fotos.get(id);
        // Solo lo posterior a la foto aporta información nueva.
        if (foto && (e.creado_en as string) <= foto.visto_en) continue;
        const acc = escrituras.get(id) ?? { en: e.creado_en as string };
        if (e.canal === "tienda_nube") acc.tn = e.stock_nuevo as number;
        if (e.canal === "mercado_libre") acc.ml = e.stock_nuevo as number;
        acc.en = e.creado_en as string;
        escrituras.set(id, acc);
      }
    }

    filas = (productos ?? []).map((p) => {
      const id = p.id as string;
      const foto = fotos.get(id);
      const post = escrituras.get(id);
      const crm = p.stock as number;
      const tn = post?.tn ?? foto?.stock_tn ?? null;
      const ml = post?.ml ?? foto?.stock_ml ?? null;
      return {
        id,
        sku: p.sku as string | null,
        nombre: p.nombre as string,
        stock_crm: crm,
        stock_tn: tn,
        stock_ml: ml,
        visto_en: post?.en ?? foto?.visto_en ?? null,
        // Solo se juzga contra los canales de los que hay dato.
        cuadrado: (tn === null || tn === crm) && (ml === null || ml === crm),
      };
    });
  }

  /* `movs` (leído arriba en paralelo) son las últimas escrituras SALIENTES del
     CRM (canal ≠ crm): lo que de verdad le mandó a las plataformas, incluidas
     las simuladas. */
  /* PostgREST devuelve la relación embebida como arreglo aunque sea 1:1. */
  const skuDe = (p: unknown): string | null => {
    const fila = Array.isArray(p) ? p[0] : p;
    return (fila as { sku?: string | null } | null)?.sku ?? null;
  };

  const movimientos: MovimientoPiloto[] = (movs ?? []).map((m) => ({
    id: m.id as number,
    sku: skuDe(m.producto),
    canal: m.canal as string,
    origen: m.origen as string,
    stock_anterior: m.stock_anterior as number | null,
    stock_nuevo: m.stock_nuevo as number,
    simulado: !!m.simulado,
    creado_en: m.creado_en as string,
  }));

  return { ...base, activo: true, filas, movimientos };
}
