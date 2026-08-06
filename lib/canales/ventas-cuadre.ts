/* ============================================================================
   lib/canales/ventas-cuadre.ts — Cuadre de ventas contra los paneles oficiales
   ----------------------------------------------------------------------------
   Dos piezas que los tres importadores (Tienda Nube, Mercado Libre, TikTok)
   necesitan por igual, y que antes no existían:

   1) `guardarTotalesOrden` — los paneles de los canales reportan el TOTAL de la
      orden (producto + envío − descuentos + impuestos). `sales.monto` solo suma
      producto, así que el CRM siempre quedaba por debajo. Los totales van a
      `sale_orders`, una fila por orden, y de ahí sale el KPI de Métricas.

   2) `refrescarRenglones` — el upsert de `sales` usa `ignoreDuplicates: true`
      para que el hub de stock no descuente dos veces la misma venta; el efecto
      colateral es que un renglón ya guardado nunca se corrige. Esta función
      llama a la RPC que actualiza los que YA existen (sin insertar ni tocar el
      stock), que es lo que permite reparar las fechas mal calculadas del
      histórico con una simple re-sincronización.

   Solo servidor (service role).
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/tipos-bd";
import { porLotes, TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";

/* Una orden tal como la reporta el panel del canal. */
export type TotalOrden = {
  canal: string;
  referencia_orden: string;
  numero?: string | null;
  fecha: string; // AAAA-MM-DD en hora de México (ver diaMX)
  total: number;
  subtotal: number;
  envio: number;
  descuento: number;
  impuesto: number;
  moneda?: string;
  estado?: string | null;
  cliente_id?: string | null;
  /* Cómo pagó y con qué cupón. Vienen dentro de la orden del canal y el CRM los
     tiraba; son las dos preguntas que obligaban a entrar al panel de la tienda
     ("¿cuánta gente paga a meses?", "¿cuánto nos cuesta el cupón de 10%?"). */
  /* Lo que se queda el canal por la venta, en positivo. Hoy solo lo manda
     Mercado Libre dentro de la orden; en los demás llega undefined y la columna
     se queda nula en vez de fingir un cero. */
  comision?: number | null;
  /* Lo que le costó el flete al VENDEDOR, en positivo. Distinto de `envio`, que
     es lo que pagó el comprador: en Mercado Libre el comprador suele pagar 0 y
     el vendedor sí paga su parte. */
  costo_envio?: number | null;
  metodo_pago?: string | null;
  cupon?: string | null;
  meses?: number | null;
};

/* Renglón recalculado, para corregir el que ya está guardado. */
export type RenglonRefrescado = {
  referencia_externa: string;
  fecha: string;
  monto: number;
  cantidad: number;
  estado?: string | null;
  paqueteria?: string | null;
  num_guia?: string | null;
  /* Enlace de rastreo tal como lo entrega el canal (Tienda Nube lo da hecho);
     null cuando el canal no lo manda y hay que derivarlo de la paquetería. */
  url_rastreo?: string | null;
  /* Enlace al pedido en el panel del canal. Se guarda en vez de deducirse porque
     Mercado Libre lo abre por `pack_id`, que solo conoce su API. */
  url_orden?: string | null;
  /* Id del shipment de Mercado Libre, para pedir la etiqueta PDF a su API. */
  envio_id?: string | null;
  /* La dirección solo llega en algunas pasadas (depende de qué devuelva el
     canal); la RPC conserva la anterior cuando viene nula. */
  envio_direccion?: unknown;
  /* Plazo de despacho y salida real (hoy solo los manda Mercado Libre). La hora
     de salida aparece después de que la venta se importó, así que llega por este
     refresco y no por el alta. Ver lib/mercadolibre/desempeno.ts. */
  envio_limite_despacho?: string | null;
  envio_despachado_en?: string | null;
};

/* Opciones de ventana compartidas por los tres importadores.
     completo → ignora la última sync y rescanea la ventana entera.
     dias     → cuántos días hacia atrás; sirve para reparar el histórico
                (las fechas viejas se guardaron sin convertir a hora de México y
                solo se corrigen volviendo a pasar por encima de ellas). */
export type OpcionesImportacion = { completo?: boolean; dias?: number };

/* Desde cuándo pedir órdenes. Con `dias` manda la ventana explícita; si no, es
   la última sync menos el traslape, y en la primera corrida la ventana larga.
   Los defaults (90 días la primera vez, 7 de traslape) eran una pareja de
   constantes copiada al inicio de los tres importadores. */
export function ventanaDesde(
  ultimaSync: string | null,
  opts: OpcionesImportacion | undefined,
  diasPrimeraVez = 90,
  diasTraslape = 7,
): Date {
  if (opts?.dias && opts.dias > 0) {
    const d = new Date();
    d.setDate(d.getDate() - opts.dias);
    return d;
  }
  const d = new Date(ultimaSync ?? Date.now());
  d.setDate(d.getDate() - (ultimaSync ? diasTraslape : diasPrimeraVez));
  return d;
}

/* Número que llega como string ("1234.50"), null o undefined → number. */
export function aMonto(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/* Rellena el envío cuando el canal no lo manda desglosado, y descarta los
   desgloses que no se sostienen.

   Tienda Nube no incluye `shipping_cost_customer` en el LISTADO de órdenes (solo
   en el detalle de cada una), pero su `total` sí lleva el envío dentro: una
   orden de 647 se guardaba como "subtotal 548 + envío 0", que no suma.

   El envío se deriva SOLO de `total - subtotal`, sin meter el descuento en la
   ecuación. Cada canal usa su propia convención —el `sub_total` de TikTok ya
   viene neto de descuento, el de Tienda Nube no— y asumir una fórmula común
   producía envíos inventados: en TikTok llegó a atribuir 2 919 de envío a una
   orden de 1 626, que era exactamente su descuento. Ante la duda, cero: un hueco
   honesto se nota y se corrige; un número inventado se propaga. */
function cuadrarDesglose(o: TotalOrden): TotalOrden {
  const ajustado = { ...o };

  /* Un descuento mayor que el total del pedido no es creíble: significa que el
     canal reporta ese campo con otra semántica (por línea, o antes de prorratear). */
  if (ajustado.descuento > ajustado.total) ajustado.descuento = 0;

  if (ajustado.envio === 0 && ajustado.subtotal > 0) {
    const deMas = Math.round((ajustado.total - ajustado.subtotal) * 100) / 100;
    if (deMas > 0) ajustado.envio = deMas;
  }
  return ajustado;
}

/* Guarda/actualiza los totales de las órdenes. A diferencia de `sales`, aquí SÍ
   se pisa lo existente: una orden puede cambiar de total (un reembolso parcial,
   un ajuste de envío) y queremos reflejarlo. */
export async function guardarTotalesOrden(ordenes: TotalOrden[]): Promise<number> {
  if (ordenes.length === 0) return 0;
  const admin = createAdminClient();

  /* Deduplicar por (canal, referencia_orden) ANTES del upsert: la paginación de
     los canales puede devolver la misma orden en dos páginas, y Postgres rechaza
     el lote entero con "ON CONFLICT DO UPDATE command cannot affect row a second
     time" si la clave se repite dentro de una misma sentencia. Se conserva la
     última aparición, que es la lectura más reciente. */
  const unicas = new Map<string, TotalOrden>();
  for (const o of ordenes) unicas.set(`${o.canal}:${o.referencia_orden}`, o);

  /* En tandas: reimportar el histórico son cientos de órdenes de una sentada. */
  const filas = [...unicas.values()].map(cuadrarDesglose);
  let guardadas = 0;
  for (let i = 0; i < filas.length; i += TAM_LOTE_UPSERT) {
    const tanda = filas.slice(i, i + TAM_LOTE_UPSERT);
    let { data, error } = await admin
      .from("sale_orders")
      .upsert(tanda, { onConflict: "canal,referencia_orden" })
      .select("id");

    /* `comision` es de una migración que se aplica a mano. Entre el deploy y el
       SQL Editor hay una ventana en la que la columna no existe, y sin esto la
       sync entera fallaría por un dato accesorio: se reintenta sin ella y las
       ventas se guardan igual. */
    if (error && /comision|costo_envio/i.test(error.message)) {
      console.warn("[ventas] faltan las columnas de costo; se guarda sin ellas.");
      const sinCostos = tanda.map((o) => {
        /* Omit y no Partial: quitar dos columnas opcionales deja una fila que
           sigue siendo válida para el insert, y `Partial` la volvía «todo
           opcional» —incluidas `canal` y `referencia_orden`, que son la llave
           del upsert—. */
        const copia: Omit<TotalOrden, "comision" | "costo_envio"> & {
          comision?: number | null;
          costo_envio?: number | null;
        } = { ...o };
        delete copia.comision;
        delete copia.costo_envio;
        return copia;
      });
      ({ data, error } = await admin
        .from("sale_orders")
        .upsert(sinCostos, { onConflict: "canal,referencia_orden" })
        .select("id"));
    }

    if (error) throw new Error(error.message);
    guardadas += data?.length ?? 0;
  }
  return guardadas;
}

/* Corrige fecha/monto/cantidad/envío de los renglones YA importados. Devuelve
   cuántos cambiaron (0 = todo estaba al día, que es lo normal en cada cron). */
export async function refrescarRenglones(
  canal: string,
  filas: RenglonRefrescado[],
): Promise<number> {
  if (filas.length === 0) return 0;
  const admin = createAdminClient();

  /* En tandas: el histórico de 90 días son miles de renglones y un solo jsonb
     con todo haría la petición innecesariamente grande. Las tandas viajan en
     oleadas paralelas; antes iban una detrás de otra. */
  const TAM = 500;
  const cuentas = await porLotes(filas, TAM, async (tanda) => {
    const { data, error } = await admin.rpc("sincronizar_renglones_venta", {
      p_canal: canal,
      /* La RPC recibe un jsonb: el tipo generado es `Json` y estas filas son
         objetos planos serializables, que es justo lo que pide. */
      p_filas: tanda as unknown as Json,
    });
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  });
  return cuentas.reduce((a, b) => a + b, 0);
}
