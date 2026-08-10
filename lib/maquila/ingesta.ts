/* ============================================================================
   lib/maquila/ingesta.ts — De la orden de Tienda Nube al tablero de Eduardo
   ----------------------------------------------------------------------------
   Recibe TODAS las órdenes de una pasada del importador (pendientes, pagadas y
   canceladas) y mantiene `maquila_pedidos` al día. Es deliberadamente distinta
   de la importación de ventas:

     · Las órdenes PENDING sí entran (bandeja "Esperando pago"); a `sales`
       nunca llegan.
     · El pago se persiste como INSTANTE (`pagado_en` = paid_at): de ahí salen
       ruta, corte y fecha prometida — desde la aprobación, no desde la compra.
     · Cancelar MARCA, nunca borra: Eduardo pudo haber producido ya, y esa
       historia es la evidencia del módulo.

   Solo los renglones cuyo producto tiene ficha en `maquila_productos` viajan
   aquí; el resto del catálogo ni se entera. Idempotente por la misma clave que
   sales: (canal, referencia_externa) = "order:variant" — webhook, cron y botón
   pueden correr juntos. Un pago ya registrado NO se recalcula: la promesa que
   vio Eduardo no se mueve porque un webhook se repita.

   Solo servidor (service role). La llama lib/tiendanube/ventas.ts al final de
   aplicarOrdenes(); su fallo jamás tira la importación de ventas.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
import { porLotes, traerPorLotes, TAM_LOTE_IN, TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";
import { diaMX, horaMX } from "@/lib/fecha";
import { tallaDeVariante, colorDeVariante } from "@/lib/talla";
import { normalizarDireccion } from "@/lib/canales/direccion";
import { obtenerModeloMaquila } from "@/lib/catalogos";
import { clasificarPago } from "@/lib/maquila/reglas";
import { cargarCalendarioMaquila, costoVigente, listarCostosMaquila } from "@/lib/maquila/consultas";
import type { OrdenTN } from "@/lib/tiendanube/api";
import type { AcabadoMaquilaId, ComboMaquilaId, ModeloMaquilaId } from "@/lib/types";

export type ResumenMaquilaTN = {
  creados: number;   // renglones nuevos (esperando pago o directo a producción)
  pagados: number;   // renglones que pasaron a producción en esta pasada
  cancelados: number;
};

/* Espejo de los predicados de lib/tiendanube/ventas.ts. Copiados y no
   importados a propósito: ventas.ts importa este módulo, y traerlos de vuelta
   armaría un ciclo por dos comparaciones de string. Si Tienda Nube cambia su
   vocabulario, cambian los dos lados. */
function esVendible(o: OrdenTN): boolean {
  return o.payment_status === "paid" && o.status !== "cancelled";
}
function estaCancelada(o: OrdenTN): boolean {
  return o.status === "cancelled" || o.payment_status === "refunded" || o.payment_status === "voided";
}

/* La ficha de maquila de una variante de Tienda Nube: qué es y cómo se
   produce. Snapshot listo para copiar al pedido. */
type FichaTN = {
  producto_id: string;
  modelo: ModeloMaquilaId;
  acabado: AcabadoMaquilaId;
  combo: ComboMaquilaId;
  nombre: string;
  sku: string | null;
  variante: string | null;
};

/* variant_id de Tienda Nube → ficha de maquila. La tabla de fichas es corta
   (decenas de diseños), así que se carga entera y se cruza en memoria; con
   traerTodo por si algún día deja de serlo. */
async function fichasPorVariante(): Promise<Map<number, FichaTN>> {
  const admin = createAdminClient();
  type Fila = {
    producto_id: string;
    modelo: ModeloMaquilaId;
    acabado: AcabadoMaquilaId;
    combo: ComboMaquilaId;
    producto: {
      nombre: string;
      sku: string | null;
      variante: string | null;
      tiendanube_variant_id: number | null;
    } | null;
  };
  const filas = await traerTodo<Fila>((desde, hasta) =>
    admin
      .from("maquila_productos")
      .select(
        "producto_id, modelo, acabado, combo," +
          " producto:products!producto_id(nombre, sku, variante, tiendanube_variant_id)",
      )
      .eq("activo", true)
      .range(desde, hasta),
  );

  const mapa = new Map<number, FichaTN>();
  for (const f of filas) {
    if (!f.producto?.tiendanube_variant_id) continue; // ficha sin variante TN: solo captura manual
    mapa.set(f.producto.tiendanube_variant_id, {
      producto_id: f.producto_id,
      modelo: f.modelo,
      acabado: f.acabado,
      combo: f.combo,
      nombre: f.producto.nombre,
      sku: f.producto.sku,
      variante: f.producto.variante,
    });
  }
  return mapa;
}

/* El renglón nuevo, con TODO en snapshot (el tablero de Eduardo no joinea
   nada). Nace esperando pago aunque la orden ya venga pagada: la promoción a
   producción pasa después por el mismo camino que un pago avisado por webhook,
   para que haya UNA sola manera de calcular fechas. */
function renglonBase(orden: OrdenTN, linea: OrdenTN["products"][number], ficha: FichaTN) {
  const d = orden.shipping_address;
  const cantidad = Math.max(1, Math.trunc(Number(linea.quantity) || 1));
  return {
    canal: "tienda_nube" as const,
    referencia_externa: `${orden.id}:${linea.variant_id}`,
    referencia_orden: String(orden.id),
    numero_orden: orden.number != null ? String(orden.number) : null,
    producto_id: ficha.producto_id,
    origen: "api" as const,
    sku: linea.sku?.trim() || ficha.sku,
    diseno: ficha.nombre,
    modelo: ficha.modelo,
    acabado: ficha.acabado,
    talla: tallaDeVariante(ficha.variante),
    color: colorDeVariante(ficha.variante),
    cantidad,
    requiere_palanca: obtenerModeloMaquila(ficha.modelo)?.llevaPalanca ?? false,
    combo: ficha.combo,
    estado: "esperando_pago" as const,
    /* Del cliente, SOLO lo que la guía pide. */
    envio_nombre: d?.name?.trim() || orden.contact_name?.trim() || null,
    envio_telefono: d?.phone?.trim() || orden.contact_phone?.trim() || null,
    envio_direccion: normalizarDireccion({
      nombre: d?.name ?? orden.contact_name,
      telefono: d?.phone ?? orden.contact_phone,
      calle: d?.address,
      numero: d?.number,
      colonia: d?.locality,
      ciudad: d?.city,
      estado: d?.province,
      cp: d?.zipcode,
      pais: d?.country,
      referencias: d?.floor,
    }),
  };
}

export async function aplicarOrdenesMaquila(ordenes: OrdenTN[]): Promise<ResumenMaquilaTN> {
  const resumen: ResumenMaquilaTN = { creados: 0, pagados: 0, cancelados: 0 };
  if (ordenes.length === 0) return resumen;

  const fichas = await fichasPorVariante();
  if (fichas.size === 0) return resumen; // aún no se marca ningún producto de maquila

  const admin = createAdminClient();

  /* 1) Dar de alta lo que no exista (pendiente O pagado; lo cancelado no se
        crea: un pedido que murió antes de conocerse no le sirve a nadie). */
  const vivas = ordenes.filter((o) => !estaCancelada(o));
  const filas = vivas.flatMap((o) =>
    (o.products ?? [])
      .filter((l) => fichas.has(l.variant_id))
      .map((l) => renglonBase(o, l, fichas.get(l.variant_id)!)),
  );
  if (filas.length > 0) {
    const tandas = await porLotes(filas, TAM_LOTE_UPSERT, async (lote) => {
      const { data, error } = await admin
        .from("maquila_pedidos")
        .upsert(lote, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    });
    resumen.creados = tandas.reduce((s, n) => s + n, 0);
  }

  /* 2) Promover a producción lo pagado que siga sin pago registrado. El
        filtro `pagado_en is null` es la idempotencia: un webhook repetido no
        recalcula la promesa que Eduardo ya vio. */
  const pagoPorRef = new Map<string, string>();
  for (const o of ordenes.filter(esVendible)) {
    for (const l of o.products ?? []) {
      if (!fichas.has(l.variant_id)) continue;
      pagoPorRef.set(`${o.id}:${l.variant_id}`, o.paid_at ?? o.created_at);
    }
  }
  if (pagoPorRef.size > 0) {
    const refs = [...pagoPorRef.keys()];
    type SinPago = {
      id: string;
      referencia_externa: string;
      modelo: ModeloMaquilaId;
      acabado: AcabadoMaquilaId;
    };
    const [sinPago, ventas, { cal }, costos] = await Promise.all([
      traerPorLotes<string, SinPago>(refs, (lote) =>
        admin
          .from("maquila_pedidos")
          .select("id, referencia_externa, modelo, acabado")
          .eq("canal", "tienda_nube")
          .in("referencia_externa", lote)
          .is("pagado_en", null),
      ),
      /* La venta hermana ya está en `sales` (aplicarOrdenes corre antes que
         esto): se liga por la misma referencia, solo para navegación interna. */
      traerPorLotes<string, { id: string; referencia_externa: string }>(refs, (lote) =>
        admin
          .from("sales")
          .select("id, referencia_externa")
          .eq("canal", "tienda_nube")
          .in("referencia_externa", lote),
      ),
      cargarCalendarioMaquila(admin),
      listarCostosMaquila(admin),
    ]);
    const ventaPorRef = new Map(ventas.map((v) => [v.referencia_externa, v.id]));

    for (const p of sinPago) {
      const pagadoEn = pagoPorRef.get(p.referencia_externa);
      if (!pagadoEn) continue;
      const cls = clasificarPago(diaMX(pagadoEn), horaMX(pagadoEn), p.acabado, cal);
      const { data: promovido, error } = await admin
        .from("maquila_pedidos")
        .update({
          pagado_en: pagadoEn,
          estado: "pendiente_produccion",
          ruta: cls.ruta,
          corte_fecha: cls.corteFecha,
          fecha_prometida: cls.fechaPrometida,
          sale_id: ventaPorRef.get(p.referencia_externa) ?? null,
        })
        .eq("id", p.id)
        .is("pagado_en", null) // carrera webhook/cron: gana el primero
        .select("id");
      if (error) throw new Error(error.message);
      /* Si el update no tocó nada, otro proceso ya promovió este pedido: su
         costo también quedó congelado y no hay que volver a escribirlo. */
      if (!promovido?.length) continue;

      /* El costo vive fuera del pedido (maquila_pedido_costos, cerrada a
         administración). La ingesta corre con service role, así que escribe
         directo; `ignoreDuplicates` para que un reintento no pise una tarifa
         ya congelada. */
      const { error: errCosto } = await admin.from("maquila_pedido_costos").upsert(
        {
          pedido_id: p.id,
          costo: costoVigente(costos, p.modelo, p.acabado, diaMX(pagadoEn)),
        },
        { onConflict: "pedido_id", ignoreDuplicates: true },
      );
      if (errCosto) throw new Error(errCosto.message);
      resumen.pagados++;
    }
  }

  /* 3) Cancelaciones y reembolsos: MARCAR, no borrar (a diferencia de sales).
        Solo alcanza a lo que sigue en manos de Eduardo; una pieza ya enviada
        no se puede des-enviar — si el dinero se devolvió, Diana registra la
        devolución a mano cuando la pieza regrese. El evento queda con autor
        null (= sistema) vía el trigger de maquila_eventos. */
  const refsCanceladas = ordenes
    .filter(estaCancelada)
    .flatMap((o) =>
      (o.products ?? [])
        .filter((l) => fichas.has(l.variant_id))
        .map((l) => `${o.id}:${l.variant_id}`),
    );
  if (refsCanceladas.length > 0) {
    const tandas = await porLotes(refsCanceladas, TAM_LOTE_IN, async (lote) => {
      const { data, error } = await admin
        .from("maquila_pedidos")
        .update({ estado: "cancelado" })
        .eq("canal", "tienda_nube")
        .in("referencia_externa", lote)
        .in("estado", ["esperando_pago", "recibido", "pendiente_produccion", "en_produccion", "terminado"])
        .select("id");
      if (error) throw new Error(error.message);
      return data?.length ?? 0;
    });
    resumen.cancelados = tandas.reduce((s, n) => s + n, 0);
  }

  return resumen;
}
