/* ============================================================================
   lib/maquila/ingesta.ts — De la orden del canal al tablero de Eduardo
   ----------------------------------------------------------------------------
   Recibe TODAS las órdenes de una pasada del importador (pendientes, pagadas y
   canceladas) y mantiene `maquila_pedidos` al día. Es deliberadamente distinta
   de la importación de ventas:

     · Las órdenes PENDING sí entran (bandeja "Esperando pago"); a `sales`
       nunca llegan.
     · El pago se persiste como INSTANTE (`pagado_en`): de ahí salen ruta, corte
       y fecha prometida — desde la aprobación, no desde la compra.
     · Cancelar MARCA, nunca borra: Eduardo pudo haber producido ya, y esa
       historia es la evidencia del módulo.

   Solo los renglones cuyo producto tiene ficha en `maquila_productos` viajan
   aquí; el resto del catálogo ni se entera. Idempotente por la misma clave que
   sales: (canal, referencia_externa) — webhook, cron y botón pueden correr
   juntos. Un pago ya registrado NO se recalcula: la promesa que vio Eduardo no
   se mueve porque un webhook se repita.

   DOS CANALES, UN NÚCLEO. Cada canal normaliza sus órdenes a `RenglonEntrante`
   y `aplicarRenglonesMaquila` hace el resto, para que el alta, la promoción al
   pago y la cancelación se comporten igual en los dos lados. Lo que cambia es
   solo cómo se reconoce la ficha:

     · Tienda Nube, por `products.tiendanube_variant_id`.
     · Mercado Libre, por `meli_publicaciones` — una misma ficha puede tener
       varias publicaciones sobre el mismo inventario (las gemelas de catálogo),
       y la venta entra por cualquiera de ellas.

   TikTok queda fuera: `maquila_pedidos.canal` no lo admite (20260924000000).

   Solo servidor (service role). Las llaman lib/tiendanube/ventas.ts y
   lib/mercadolibre/ventas.ts al final de aplicarOrdenes(); su fallo jamás tira
   la importación de ventas.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
import { porLotes, traerPorLotes, TAM_LOTE_IN, TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";
import { diaMX, horaMX } from "@/lib/fecha";
import { tallaDeVariante, colorDeVariante } from "@/lib/talla";
import { normalizarDireccion, type DireccionEnvio } from "@/lib/canales/direccion";
import { obtenerModeloMaquila } from "@/lib/catalogos";
import { clasificarPago } from "@/lib/maquila/reglas";
import { cargarCalendarioMaquila, costoVigente, listarCostosMaquila } from "@/lib/maquila/consultas";
import { sembrarPersonalizadosDeMaquila } from "@/lib/personalizados/desde-maquila";
import type { OrdenTN } from "@/lib/tiendanube/api";
import type { OrdenML } from "@/lib/mercadolibre/api";
import type { AcabadoMaquilaId, ComboMaquilaId, ModeloMaquilaId } from "@/lib/types";

export type ResumenMaquila = {
  creados: number;   // renglones nuevos (esperando pago o directo a producción)
  pagados: number;   // renglones que pasaron a producción en esta pasada
  cancelados: number;
};

/* Los canales que la tabla admite. */
type CanalMaquila = "tienda_nube" | "mercado_libre";

/* La ficha de maquila de una unidad vendible: qué es y cómo se produce.
   Snapshot listo para copiar al pedido. */
type Ficha = {
  producto_id: string;
  modelo: ModeloMaquilaId;
  acabado: AcabadoMaquilaId;
  combo: ComboMaquilaId;
  nombre: string;
  sku: string | null;
  variante: string | null;
  imagen_url: string | null;
};

/* Lo que el núcleo necesita de un renglón, venga del canal que venga. */
type RenglonEntrante = {
  referencia_externa: string;
  /* La fila a insertar si todavía no existe. */
  fila: FilaNueva;
  /* Instante del pago si la orden ya está aprobada; null si sigue esperando. */
  pagadoEn: string | null;
  /* La orden murió: ni se crea ni se promueve, solo se marca lo que ya existía. */
  cancelada: boolean;
};

type FilaNueva = ReturnType<typeof renglonBase>;

/* ---- Las fichas, por canal ------------------------------------------------ */

type FilaFicha = {
  producto_id: string;
  modelo: ModeloMaquilaId;
  acabado: AcabadoMaquilaId;
  combo: ComboMaquilaId;
  producto: {
    nombre: string;
    sku: string | null;
    variante: string | null;
    imagen_url: string | null;
    tiendanube_variant_id: number | null;
  } | null;
};

/* Todas las fichas activas con su producto. La tabla es corta (decenas de
   diseños), así que se carga entera y se cruza en memoria; con traerTodo por si
   algún día deja de serlo. */
async function fichasActivas(): Promise<FilaFicha[]> {
  const admin = createAdminClient();
  return traerTodo<FilaFicha>((desde, hasta) =>
    admin
      .from("maquila_productos")
      .select(
        "producto_id, modelo, acabado, combo," +
          " producto:products!producto_id(nombre, sku, variante, imagen_url, tiendanube_variant_id)",
      )
      .eq("activo", true)
      .range(desde, hasta),
  );
}

function aFicha(f: FilaFicha): Ficha {
  return {
    producto_id: f.producto_id,
    modelo: f.modelo,
    acabado: f.acabado,
    combo: f.combo,
    nombre: f.producto!.nombre,
    sku: f.producto!.sku,
    variante: f.producto!.variante,
    imagen_url: f.producto!.imagen_url,
  };
}

/* variant_id de Tienda Nube → ficha. */
async function fichasPorVarianteTN(): Promise<Map<number, Ficha>> {
  const mapa = new Map<number, Ficha>();
  for (const f of await fichasActivas()) {
    if (!f.producto?.tiendanube_variant_id) continue; // sin variante TN: otro canal o captura manual
    mapa.set(f.producto.tiendanube_variant_id, aFicha(f));
  }
  return mapa;
}

/* "itemId:variationId" de Mercado Libre → ficha. El cruce va por
   `meli_publicaciones` y no por `products.meli_item_id` por la misma razón que
   en lib/mercadolibre/ventas.ts: una ficha puede tener varias publicaciones
   sobre el mismo inventario y la venta entra por cualquiera. */
async function fichasPorUnidadML(): Promise<Map<string, Ficha>> {
  const fichas = await fichasActivas();
  if (!fichas.length) return new Map();

  const admin = createAdminClient();
  const publicaciones = await traerPorLotes<
    string,
    { meli_item_id: string; meli_variation_id: number | null; producto_id: string }
  >(
    fichas.map((f) => f.producto_id),
    (lote) =>
      admin
        .from("meli_publicaciones")
        .select("meli_item_id, meli_variation_id, producto_id")
        .in("producto_id", lote),
  );

  const porProducto = new Map(fichas.map((f) => [f.producto_id, f]));
  const mapa = new Map<string, Ficha>();
  for (const p of publicaciones) {
    const f = porProducto.get(p.producto_id);
    if (!f?.producto) continue;
    mapa.set(claveUnidadML(p.meli_item_id, p.meli_variation_id), aFicha(f));
  }
  return mapa;
}

/* Espejo de claveUnidad() en lib/mercadolibre/ventas.ts. */
function claveUnidadML(itemId: string, variationId: number | null): string {
  return `${itemId}:${variationId ?? ""}`;
}

/* ---- El renglón nuevo ----------------------------------------------------- */

/* Con TODO en snapshot (el tablero de Eduardo no joinea nada). Nace esperando
   pago aunque la orden ya venga pagada: la promoción a producción pasa después
   por el mismo camino que un pago avisado por webhook, para que haya UNA sola
   manera de calcular fechas. */
function renglonBase(datos: {
  canal: CanalMaquila;
  referencia_externa: string;
  referencia_orden: string;
  numero_orden: string | null;
  ficha: Ficha;
  cantidad: number;
  sku: string | null;
  direccion: DireccionEnvio | null;
}) {
  const d = datos.direccion;
  return {
    canal: datos.canal,
    referencia_externa: datos.referencia_externa,
    referencia_orden: datos.referencia_orden,
    numero_orden: datos.numero_orden,
    producto_id: datos.ficha.producto_id,
    origen: "api" as const,
    sku: datos.sku ?? datos.ficha.sku,
    diseno: datos.ficha.nombre,
    /* La portada se CONGELA aquí: si mañana cambia la del catálogo, el pedido
       conserva la que se produjo. Y va en el snapshot porque `es_interno()` no
       incluye al maquilero: un join a products le devolvería vacío. */
    imagen_url: datos.ficha.imagen_url,
    modelo: datos.ficha.modelo,
    acabado: datos.ficha.acabado,
    talla: tallaDeVariante(datos.ficha.variante),
    color: colorDeVariante(datos.ficha.variante),
    cantidad: Math.max(1, Math.trunc(datos.cantidad || 1)),
    requiere_palanca: obtenerModeloMaquila(datos.ficha.modelo)?.llevaPalanca ?? false,
    combo: datos.ficha.combo,
    estado: "esperando_pago" as const,
    /* Del cliente, SOLO lo que la guía pide. */
    envio_nombre: d?.nombre?.trim() || null,
    envio_telefono: d?.telefono?.trim() || null,
    envio_direccion: d,
  };
}

/* ---- El núcleo: alta, promoción y cancelación ----------------------------- */

export async function aplicarRenglonesMaquila(
  canal: CanalMaquila,
  renglones: RenglonEntrante[],
): Promise<ResumenMaquila> {
  const resumen: ResumenMaquila = { creados: 0, pagados: 0, cancelados: 0 };
  if (renglones.length === 0) return resumen;

  const admin = createAdminClient();

  /* 1) Dar de alta lo que no exista (pendiente O pagado; lo cancelado no se
        crea: un pedido que murió antes de conocerse no le sirve a nadie). */
  const filas = renglones.filter((r) => !r.cancelada).map((r) => r.fila);
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
  for (const r of renglones) {
    if (r.cancelada || !r.pagadoEn) continue;
    pagoPorRef.set(r.referencia_externa, r.pagadoEn);
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
          .eq("canal", canal)
          .in("referencia_externa", lote)
          .is("pagado_en", null),
      ),
      /* La venta hermana ya está en `sales` (aplicarOrdenes corre antes que
         esto): se liga por la misma referencia, solo para navegación interna. */
      traerPorLotes<string, { id: string; referencia_externa: string }>(refs, (lote) =>
        admin
          .from("sales")
          .select("id, referencia_externa")
          .eq("canal", canal)
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
  const refsCanceladas = renglones.filter((r) => r.cancelada).map((r) => r.referencia_externa);
  if (refsCanceladas.length > 0) {
    const tandas = await porLotes(refsCanceladas, TAM_LOTE_IN, async (lote) => {
      const { data, error } = await admin
        .from("maquila_pedidos")
        .update({ estado: "cancelado" })
        .eq("canal", canal)
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

/* ---- Tienda Nube ---------------------------------------------------------- */

/* Espejo de los predicados de lib/tiendanube/ventas.ts. Copiados y no
   importados a propósito: ventas.ts importa este módulo, y traerlos de vuelta
   armaría un ciclo por dos comparaciones de string. Si Tienda Nube cambia su
   vocabulario, cambian los dos lados. */
function esVendibleTN(o: OrdenTN): boolean {
  return o.payment_status === "paid" && o.status !== "cancelled";
}
function estaCanceladaTN(o: OrdenTN): boolean {
  return o.status === "cancelled" || o.payment_status === "refunded" || o.payment_status === "voided";
}

export async function aplicarOrdenesMaquila(ordenes: OrdenTN[]): Promise<ResumenMaquila> {
  if (ordenes.length === 0) return { creados: 0, pagados: 0, cancelados: 0 };

  const fichas = await fichasPorVarianteTN();
  if (fichas.size === 0) return { creados: 0, pagados: 0, cancelados: 0 };

  const renglones: RenglonEntrante[] = [];
  for (const orden of ordenes) {
    const cancelada = estaCanceladaTN(orden);
    const pagadoEn = esVendibleTN(orden) ? (orden.paid_at ?? orden.created_at) : null;
    const d = orden.shipping_address;
    for (const linea of orden.products ?? []) {
      const ficha = fichas.get(linea.variant_id);
      if (!ficha) continue;
      const referencia_externa = `${orden.id}:${linea.variant_id}`;
      renglones.push({
        referencia_externa,
        pagadoEn,
        cancelada,
        fila: renglonBase({
          canal: "tienda_nube",
          referencia_externa,
          referencia_orden: String(orden.id),
          numero_orden: orden.number != null ? String(orden.number) : null,
          ficha,
          cantidad: Number(linea.quantity),
          sku: linea.sku?.trim() || null,
          direccion: normalizarDireccion({
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
        }),
      });
    }
  }

  const resumen = await aplicarRenglonesMaquila("tienda_nube", renglones);
  await sembrarFichas();
  return resumen;
}

/* La ficha del diseñador, para los pedidos personalizados que aún no la tienen.
   Va después de dar de alta los pedidos y NUNCA tira la ingesta: el pedido ya
   está en el tablero de Eduardo, y una ficha que no se creó se vuelve a
   intentar en la pasada siguiente (la condición de alta es que el pedido no
   tenga ficha). */
async function sembrarFichas(): Promise<void> {
  try {
    const { creadas } = await sembrarPersonalizadosDeMaquila(createAdminClient());
    if (creadas > 0) console.info(`[maquila] ${creadas} ficha(s) de personalizado creadas.`);
  } catch (e) {
    console.error("[maquila] siembra de fichas de personalizado:", e);
  }
}

/* ---- Mercado Libre -------------------------------------------------------- */

/* Espejo de los predicados de lib/mercadolibre/ventas.ts, copiados por la misma
   razón que los de Tienda Nube. En ML no existe el "pendiente de pago" de TN:
   una orden `paid` entra ya aprobada y pasa derecho a producción. */
function esVendibleML(o: OrdenML): boolean {
  return o.status === "paid";
}
function estaCanceladaML(o: OrdenML): boolean {
  return o.status === "cancelled" || o.status === "invalid";
}

/* `direcciones` lo pasa ventas.ts con lo que YA pidió a la API de envíos: sacar
   la dirección otra vez aquí sería duplicar las llamadas de una sync completa.
   Sin ella el pedido entra sin datos de envío, que es recuperable a mano; sin
   la ficha, en cambio, el renglón no entra en absoluto. */
export async function aplicarOrdenesMaquilaML(
  ordenes: OrdenML[],
  direcciones: Map<number, DireccionEnvio | null>,
): Promise<ResumenMaquila> {
  if (ordenes.length === 0) return { creados: 0, pagados: 0, cancelados: 0 };

  const fichas = await fichasPorUnidadML();
  if (fichas.size === 0) return { creados: 0, pagados: 0, cancelados: 0 };

  const renglones: RenglonEntrante[] = [];
  for (const orden of ordenes) {
    const cancelada = estaCanceladaML(orden);
    const pagadoEn = esVendibleML(orden) ? (orden.date_closed ?? orden.date_created) : null;
    const direccion = direcciones.get(orden.id) ?? null;
    for (const linea of orden.order_items ?? []) {
      const variationId = linea.item.variation_id ?? null;
      const ficha = fichas.get(claveUnidadML(linea.item.id, variationId));
      if (!ficha) continue;
      /* La MISMA referencia que arma refLinea() en lib/mercadolibre/ventas.ts:
         si se separaran, el pedido no encontraría su venta hermana. */
      const referencia_externa = `${orden.id}:${linea.item.id}:${variationId ?? ""}`;
      renglones.push({
        referencia_externa,
        pagadoEn,
        cancelada,
        fila: renglonBase({
          canal: "mercado_libre",
          referencia_externa,
          referencia_orden: String(orden.id),
          /* ML no tiene folio aparte: el número de orden ES el id, y es lo que
             se ve en su panel (igual que sale_orders.numero). */
          numero_orden: String(orden.id),
          ficha,
          cantidad: Number(linea.quantity),
          sku: null, // la línea de ML no trae SKU: manda el de la ficha
          direccion,
        }),
      });
    }
  }

  const resumen = await aplicarRenglonesMaquila("mercado_libre", renglones);
  await sembrarFichas();
  return resumen;
}
