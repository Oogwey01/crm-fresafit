/* ============================================================================
   lib/canales/despacho.ts — El plazo para entregarle el paquete al transportista
   ----------------------------------------------------------------------------
   Los canales dan una hora límite para despachar y, después, la hora real de
   salida. Con ese par se decide lo único que importa al empacar: qué pedido va
   primero. Vivía dentro de lib/mercadolibre/desempeno.ts, de cuando Mercado
   Libre era el único canal que reportaba el plazo; hoy TikTok Shop también lo
   manda (`rts_sla_time` / `rts_time`, ver lib/tiktok/ventas.ts) y el criterio
   tiene que ser el mismo para los dos: un pedido vencido se ve igual sin
   importar por dónde entró.

   Los dos datos se guardan por venta en `sales.envio_limite_despacho` y
   `sales.envio_despachado_en`. Cuando el canal no los reporta —Tienda Nube—
   quedan nulos y aquí no se inventa nada: sin plazo no hay semáforo.
   ============================================================================ */

/* Lo que el equipo de logística necesita saber de un pedido: si su plazo ya se
   venció, si vence hoy, o si salió tarde. */
export type SituacionDespacho = "vencido" | "por_vencer" | "a_tiempo" | "tarde" | "cumplido";

/* Cuánto antes del límite empieza a considerarse urgente. Seis horas es menos
   que una jornada: si vence dentro de ese plazo, ya no cabe dejarlo para mañana. */
export const HORAS_URGENTE = 6;

export function situacionDespacho(
  limite: string | null,
  despachadoEn: string | null,
  ahora: number = Date.now(),
): SituacionDespacho | null {
  if (!limite) return null;
  const tope = Date.parse(limite);
  if (Number.isNaN(tope)) return null;

  if (despachadoEn) {
    const salida = Date.parse(despachadoEn);
    if (Number.isNaN(salida)) return null;
    return salida > tope ? "tarde" : "cumplido";
  }
  if (ahora > tope) return "vencido";
  return tope - ahora <= HORAS_URGENTE * 3600 * 1000 ? "por_vencer" : "a_tiempo";
}

export const SITUACION: Record<
  SituacionDespacho,
  { nombre: string; color: string; urgente: boolean }
> = {
  vencido: { nombre: "Se pasó el plazo", color: "#d63031", urgente: true },
  por_vencer: { nombre: "Vence en horas", color: "#e17055", urgente: true },
  a_tiempo: { nombre: "En plazo", color: "#0984e3", urgente: false },
  tarde: { nombre: "Salió tarde", color: "#d63031", urgente: false },
  cumplido: { nombre: "Salió a tiempo", color: "#00b894", urgente: false },
};

/* El "ahora" contra el que se miden todos los plazos de una pantalla. Se toma
   una sola vez por request y se le pasa a todo lo que compara fechas: una página
   que leyera la hora en cada fila podría clasificar distinto dos pedidos con el
   mismo vencimiento. */
export function instanteDeCorte(): number {
  return Date.now();
}

/* ---------------------------------------------------------------------------
   ¿DE QUIÉN ES EL TRABAJO?

   "Preparando" significaba tres cosas a la vez: el paquete sin tocar en la
   bodega, el paquete ya empacado esperando la colecta, y el paquete que vive en
   un centro de Mercado Full a cientos de kilómetros. Los tres salían en
   Urgentes, y de los nueve pendientes de Mercado Libre del 17/08/2026 SOLO los
   primeros eran trabajo — que resultaron ser cero.

   El canal sí lo distingue, en dos datos que ahora se guardan
   (`sales.envio_subestado` y `sales.envio_logistica`, migración 20261021000000).
   La traducción vive aquí y no en la base a propósito: cada canal nombra sus
   etapas a su manera y cambiarlas no debe costar una migración.
   --------------------------------------------------------------------------- */

/* Dónde está el paquete cuando el pedido todavía no sale.

   · `en_bodega`   — hay que empacarlo, o ya está empacado pero sigue aquí.
   · `por_recoger` — empacado y etiquetado; falta que pase la colecta.
   · `en_el_canal` — está en un centro del canal (Mercado Full). No hay nada
     que hacer, y ni siquiera se recibe plazo de despacho: ML despacha solo. */
export type SituacionPreparacion = "en_bodega" | "por_recoger" | "en_el_canal";

/* Mercado Full: el inventario está en un centro de ML, que empaca y despacha.
   Lo mismo vale para su variante `fulfillment_extended`.

   Se exporta porque la pantalla de Pedidos necesita apartar esos pedidos
   SIEMPRE —también después de que salen—, y `situacionPreparacion` no sirve
   para eso a propósito: describe la etapa ANTERIOR al envío y se calla en
   cuanto el pedido sale. Qué significa cada valor de `envio_logistica` es
   conocimiento del canal y vive aquí; repetir el `startsWith` en la UI es lo
   que hace que el día que ML invente un tercer prefijo solo se arregle en un
   sitio. */
export function esDelCanal(logistica: string | null | undefined): boolean {
  return !!logistica && logistica.startsWith("fulfillment");
}

/* Subestados de `ready_to_ship` en los que el paquete ya está cerrado y solo
   espera al transportista. `printed` y `picked` cuentan: con la etiqueta puesta
   ya no queda nada que empacar. Los que NO están aquí —`ready_to_print`,
   `invoice_pending`— siguen siendo trabajo. */
const SUBESTADOS_LISTO = new Set(["ready_for_pickup", "ready_to_ship", "printed", "picked"]);

export function situacionPreparacion(
  logistica: string | null | undefined,
  subestado: string | null | undefined,
): SituacionPreparacion {
  if (esDelCanal(logistica ?? null)) return "en_el_canal";
  return subestado && SUBESTADOS_LISTO.has(subestado) ? "por_recoger" : "en_bodega";
}

export const PREPARACION: Record<
  SituacionPreparacion,
  { nombre: string; color: string; /* ¿queda trabajo de bodega? */ pendiente: boolean }
> = {
  en_bodega: { nombre: "Por empacar", color: "#f59e0b", pendiente: true },
  /* El mismo nombre que usa el panel de Mercado Libre, para que quien mira las
     dos pantallas no tenga que traducir. */
  por_recoger: { nombre: "Listo para recolección", color: "#0984e3", pendiente: false },
  en_el_canal: { nombre: "En centro del canal", color: "#6c5ce7", pendiente: false },
};
