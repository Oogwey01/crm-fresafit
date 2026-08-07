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
