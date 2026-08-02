/* ============================================================================
   lib/inventario/reparacion.ts — Reparación automática de desviaciones
   ----------------------------------------------------------------------------
   Cuando un empuje del CRM a un canal no llega (la API falló, el candado lo
   descartó, el proceso murió a medias), el descuadre queda ahí hasta que la
   sincronización diaria lo tropieza. Eso son hasta 24 horas vendiendo con
   números distintos en cada lado. Esto lo acorta a una hora, aprovechando la
   foto horaria que ya lee los tres canales.

   EL PELIGRO: reconciliar dice QUE hay diferencia, no QUIÉN tiene la razón. Si
   el CRM dice 455 y Tienda Nube dice 456 puede ser que el empuje del CRM no
   llegó (manda el CRM), o que hubo una venta en TN que el CRM aún no importó
   (manda TN). Corregir siempre a favor del CRM es exactamente lo que borró 27
   unidades el 18/07: imponer un número propio encima de movimientos reales.

   Por eso esto NO corrige salvo que pueda demostrar que el canal se quedó atrás.
   Cuatro condiciones, todas obligatorias:

     1. El producto está dentro del piloto (lista blanca de SKUs) y el canal
        tiene la escritura habilitada. Fuera de ahí, solo se avisa.
     2. El descuadre sobrevivió a dos fotos seguidas sin que ningún número se
        moviera. Una venta en vuelo se resuelve sola en la hora siguiente; un
        empuje perdido no.
     3. El ledger prueba que el CRM se movió y el canal no:
          a) el stock actual del CRM es el resultado de su último movimiento
             registrado (nada lo cambió por fuera), y
          b) el valor en el canal es un valor por el que el CRM pasó — está
             literalmente un movimiento atrás, y
          c) no hay ningún cambio observado en ese canal DESPUÉS de aquel
             movimiento. Si el canal se movió por su cuenta, quien tiene la
             razón puede ser él: no se toca.
     4. La diferencia cabe en el límite de cordura del hub.

   Cualquier condición que falle deja el descuadre intacto y devuelve una
   incidencia. Un rojo visible en el monitor es mejor que una corrección
   silenciosa equivocada.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { modoEscritura, puedeEscribir } from "@/lib/inventario/escritura-canales";
import { LIMITE_CORDURA, propagarStock, type FilaVinculada } from "@/lib/inventario/stock-hub";
import type { DesviacionEstable } from "@/lib/inventario/foto-canales";

/* Hasta dónde se busca hacia atrás el movimiento del CRM que justifica la
   corrección. Más allá de un día, un descuadre ya no es "una escritura que no
   llegó": es deriva de origen desconocido, y eso se mira a mano. */
const VENTANA_MOVIMIENTO_MS = 24 * 60 * 60 * 1000;

export type ResultadoReparacion = {
  revisadas: number; // desviaciones estables examinadas
  corregidas: number; // productos a los que se les reenvió el valor del CRM
  descartadas: number; // no pudieron demostrar quién tiene la razón
  incidencias: string[]; // el porqué de cada descarte, más los fallos de escritura
};

type Producto = {
  id: string;
  sku: string | null;
  stock: number;
  bajo_pedido: boolean | null;
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
  meli_logistic_type: string | null;
};

type MovimientoCRM = { stock_anterior: number | null; stock_nuevo: number; creado_en: string };

/* Un cambio observado por la foto, por canal. */
type CambioCanal = { tn: boolean; ml: boolean; en: string };

export async function repararDesviaciones(
  desviaciones: DesviacionEstable[],
): Promise<ResultadoReparacion> {
  const vacio: ResultadoReparacion = {
    revisadas: 0,
    corregidas: 0,
    descartadas: 0,
    incidencias: [],
  };
  if (modoEscritura() === "off" || desviaciones.length === 0) return vacio;

  const admin = createAdminClient();
  const desde = new Date(Date.now() - VENTANA_MOVIMIENTO_MS).toISOString();

  /* Solo los productos con escritura habilitada llegan a evaluarse. Durante el
     piloto son un puñado, así que todo lo que sigue trabaja sobre una lista
     corta aunque el catálogo entero esté descuadrado. */
  const productos = new Map<string, Producto>();
  const ids = desviaciones.map((d) => d.producto_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("products")
      .select(
        "id, sku, stock, bajo_pedido, tiendanube_product_id, tiendanube_variant_id, meli_item_id, meli_variation_id, meli_logistic_type",
      )
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as Producto[]) productos.set(p.id, p);
  }

  const candidatas = desviaciones.filter((d) => {
    const p = productos.get(d.producto_id);
    if (!p || p.bajo_pedido) return false;
    return puedeEscribir("tiendanube", p.sku) || puedeEscribir("mercadolibre", p.sku);
  });
  if (candidatas.length === 0) return { ...vacio, revisadas: desviaciones.length };

  const habilitados = candidatas.map((d) => d.producto_id);

  /* Los dos ledgers se leen sobre el mismo set `habilitados` y no dependen uno
     del otro: en paralelo. */
  const [ledgerCRM, ledgerCanales] = await Promise.all([
    admin
      .from("stock_log")
      .select("producto_id, stock_anterior, stock_nuevo, creado_en")
      .in("producto_id", habilitados)
      .eq("canal", "crm")
      .eq("simulado", false)
      .gte("creado_en", desde)
      .order("creado_en", { ascending: true }),
    admin
      .from("stock_canal_log")
      .select("producto_id, stock_tn_ant, stock_tn, stock_ml_ant, stock_ml, detectado_en")
      .in("producto_id", habilitados)
      .gte("detectado_en", desde)
      .order("detectado_en", { ascending: true }),
  ]);

  /* Movimientos propios del CRM: la prueba de que su número tiene origen. */
  const movimientos = new Map<string, MovimientoCRM[]>();
  {
    const { data, error } = ledgerCRM;
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      const id = m.producto_id as string;
      const lista = movimientos.get(id) ?? [];
      lista.push({
        stock_anterior: m.stock_anterior as number | null,
        stock_nuevo: m.stock_nuevo as number,
        creado_en: m.creado_en as string,
      });
      movimientos.set(id, lista);
    }
  }

  /* Cambios que la foto vio en los canales: la prueba de que alguien más los
     movió. Solo interesa QUÉ canal se movió y CUÁNDO. */
  const observados = new Map<string, CambioCanal[]>();
  {
    const { data, error } = ledgerCanales;
    if (error) throw new Error(error.message);
    const movio = (a: unknown, b: unknown) =>
      a !== null && b !== null && a !== undefined && b !== undefined && a !== b;
    for (const c of data ?? []) {
      const id = c.producto_id as string;
      const lista = observados.get(id) ?? [];
      lista.push({
        tn: movio(c.stock_tn_ant, c.stock_tn),
        ml: movio(c.stock_ml_ant, c.stock_ml),
        en: c.detectado_en as string,
      });
      observados.set(id, lista);
    }
  }

  const incidencias: string[] = [];
  const filas: FilaVinculada[] = [];
  let descartadas = 0;

  for (const d of candidatas) {
    const p = productos.get(d.producto_id)!;
    const nombre = p.sku?.trim() || p.id;

    /* El stock del CRM cambió entre la foto y ahora: la premisa de "esto lleva
       dos horas quieto" ya no vale. Que lo vea la foto siguiente. */
    if (p.stock !== d.stock_crm) continue;

    const movs = movimientos.get(d.producto_id) ?? [];
    const ultimo = movs[movs.length - 1];

    /* (3a) Sin un movimiento registrado que termine justo en el stock actual, el
       número del CRM no está respaldado por nada: puede ser él quien esté mal. */
    if (!ultimo || ultimo.stock_nuevo !== p.stock) {
      descartadas++;
      incidencias.push(
        `${nombre}: descuadrado (CRM ${p.stock}, TN ${d.stock_tn ?? "—"}, ML ${d.stock_ml ?? "—"}) pero el CRM no tiene un movimiento reciente que explique su número. No se corrige solo; revísalo.`,
      );
      continue;
    }

    const cambios = observados.get(d.producto_id) ?? [];

    const evaluar = (canal: "tiendanube" | "mercadolibre", campo: "tn" | "ml"): boolean => {
      const valor = campo === "tn" ? d.stock_tn : d.stock_ml;
      const etiqueta = campo === "tn" ? "Tienda Nube" : "Mercado Libre";
      if (valor === null || valor === p.stock) return false; // sin dato o ya cuadrado
      if (!puedeEscribir(canal, p.sku)) return false; // fuera del piloto: solo se observa

      // (4) El mismo tope que usa el hub para cualquier escritura automática.
      if (Math.abs(p.stock - valor) > LIMITE_CORDURA) {
        incidencias.push(
          `${nombre}: ${etiqueta} está en ${valor} y el CRM en ${p.stock}. La diferencia supera el límite de ${LIMITE_CORDURA}; no se corrige sola.`,
        );
        return false;
      }
      // (3b) El canal debe estar parado en un valor por el que el CRM pasó.
      if (!movs.some((m) => m.stock_anterior === valor)) {
        incidencias.push(
          `${nombre}: ${etiqueta} está en ${valor}, que no corresponde a ningún valor por el que haya pasado el CRM. No se sabe quién tiene la razón; revísalo.`,
        );
        return false;
      }
      // (3c) Si el canal se movió por su cuenta después, puede ser él quien manda.
      if (cambios.some((c) => c[campo] && c.en > ultimo.creado_en)) {
        incidencias.push(
          `${nombre}: ${etiqueta} se movió por su cuenta después del último cambio del CRM. No se corrige automáticamente para no borrar ese movimiento.`,
        );
        return false;
      }
      return true;
    };

    const okTN = evaluar("tiendanube", "tn");
    const okML = evaluar("mercadolibre", "ml");

    if (!okTN && !okML) {
      descartadas++;
      continue;
    }

    /* Se empuja el valor ABSOLUTO del CRM, sin delta. Es la única situación en
       la que hacerlo es seguro: acabamos de demostrar que el canal se quedó
       exactamente donde el CRM lo dejó y no se ha movido desde entonces.
       Los canales que no pasaron el examen van en null para que el hub ni los
       mire — así una reparación de Tienda Nube no arrastra a Mercado Libre. */
    filas.push({
      id: p.id,
      sku: p.sku,
      bajo_pedido: p.bajo_pedido,
      tiendanube_product_id: okTN ? p.tiendanube_product_id : null,
      tiendanube_variant_id: okTN ? p.tiendanube_variant_id : null,
      meli_item_id: okML ? p.meli_item_id : null,
      meli_variation_id: okML ? p.meli_variation_id : null,
      meli_logistic_type: p.meli_logistic_type,
      stock: p.stock,
      delta: null,
    });
  }

  if (filas.length > 0) {
    incidencias.push(...(await propagarStock("crm", filas, "reparacion")));
  }

  return {
    revisadas: desviaciones.length,
    corregidas: filas.length,
    descartadas,
    incidencias,
  };
}
