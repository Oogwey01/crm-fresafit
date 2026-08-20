/* ============================================================================
   lib/pedidos/bandejas.ts — De quién es el trabajo de cada pedido
   ----------------------------------------------------------------------------
   Vivía dentro de components/pedidos/panel.tsx, de cuando la pantalla era una
   tabla y nadie más necesitaba estas respuestas. Salió de ahí cuando llegó el
   tablero de empaque: las dos vistas tienen que clasificar IGUAL —si la tabla y
   el tablero discreparan en qué es "por empacar", los números de las pestañas
   dejarían de cuadrar con lo que se ve— y la única forma de garantizarlo es que
   compartan estas funciones en vez de tener cada una las suyas.

   Es también lo que pide ARQUITECTURA.md: la lógica de dominio va en `lib/`.
   ============================================================================ */

import { PREPARACION, esDelCanal, situacionDespacho, situacionPreparacion } from "@/lib/canales/despacho";
import type { SituacionPreparacion } from "@/lib/canales/despacho";
import { diaMX, diasDesdeFecha, esPedidoAtrasado } from "@/lib/fecha";
import type { EnProduccion } from "@/lib/pedidos/produccion";
import type { EtapaEmpaqueId, PedidoEnvio } from "@/lib/types";

/* Las cuatro BANDEJAS en las que se reparte, SIN SOLAPARSE, todo lo que la
   página carga. Responden la única pregunta que importa al abrir la pantalla:
   ¿de quién es esto y qué falta?

     · por_empacar — hay que armar la caja. Es el trabajo.
     · listos      — empacado y etiquetado; falta que pase la colecta.
     · full        — lo despacha Mercado Libre desde su centro. Nunca fue nuestro.
     · en_camino   — salió de aquí y va en la calle.

   Las cuatro salían juntas en "Pendientes": 336 renglones el 17/08/2026, de los
   que solo 158 eran trabajo. Para encontrarlos había que leerlos todos.

   Que sean bandejas y no cuatro filtros sueltos es lo que hace que los números
   de las pestañas SUMEN el total. Con condiciones independientes, un pedido
   podía caer en dos listas y nadie se enteraba. */
export type Bandeja = "por_empacar" | "listos" | "full" | "en_camino";

export function bandeja(p: PedidoEnvio): Bandeja {
  /* Full manda sobre todo, incluso sobre "enviado": el motivo de apartarlo no
     es en qué etapa va, sino que el trabajo no es nuestro. Si ganara "enviado",
     el pedido cambiaría de pestaña el día que ML lo despacha y acabaría en la
     lista donde lo único que se hace es llamarle a la paquetería — que es justo
     lo que en Full no se puede hacer. Son 15 de los enviados de hoy. */
  if (esDelCanal(p.envio_logistica)) return "full";
  if (p.estado === "enviado") return "en_camino";
  if (preparacion(p) === "por_recoger") return "listos";
  return "por_empacar";
}

/* `referencia_externa` es por RENGLÓN ("<orden>:<línea>"); lo que identifica al
   pedido de cara al cliente es la parte de la orden. */
export function numeroOrden(ref: string): string {
  return ref.split(":")[0];
}

/* Dónde está el paquete de un pedido que aún no sale. Para los que ya salieron
   —enviado en adelante— no aplica: el subestado que quedó guardado describe una
   etapa que ya pasó. */
export function preparacion(p: PedidoEnvio): SituacionPreparacion | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  return situacionPreparacion(p.envio_logistica, p.envio_subestado);
}

/* ¿Queda trabajo de bodega? Es la pregunta que decide qué sale en Urgentes.
   Un paquete ya empacado esperando la colecta, o uno que vive en un centro de
   Mercado Full, no lo es — por muy vencido que esté el plazo, apurarse no
   cambia nada—. Sin el dato del canal (Tienda Nube no lo manda) se asume que sí:
   es lo que había antes y es el lado seguro. */
export function hayTrabajo(p: PedidoEnvio): boolean {
  const s = preparacion(p);
  return s === null || PREPARACION[s].pendiente;
}

/* Plazo de despacho del canal (la sync lo deja en la venta; hoy lo reportan
   Mercado Libre y TikTok Shop): solo avisa mientras el pedido da trabajo —nuevo
   o preparando, y todavía en la bodega— y solo cuando urge. Ya enviado, "se pasó
   el plazo" es ruido; en plazo holgado, también; y sobre un paquete que ya está
   hecho, es una alarma que nadie puede atender. */
export function plazoUrgente(p: PedidoEnvio, ahora: number): "vencido" | "por_vencer" | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  if (!hayTrabajo(p)) return null;
  const s = situacionDespacho(p.envio_limite_despacho, p.envio_despachado_en, ahora);
  return s === "vencido" || s === "por_vencer" ? s : null;
}

/* Cuánto lleva en la calle un paquete que ya salió. Es la contraparte tranquila
   de `esPedidoAtrasado`: los enviados salieron de "atrasados" —despachar ya no
   está pendiente— pero saber que uno lleva 18 días sin confirmarse sigue siendo
   útil para llamar a la paquetería. Gris a propósito: informa, no alarma. */
export const DIAS_TRANSITO_VISIBLE = 5;

/* El umbral es parámetro porque depende de dónde se mire: en una lista mezclada,
   "salió ayer" es ruido; en la vista de En camino los días en la calle son la
   razón de ser de la lista y el criterio con el que se decide a quién llamarle. */
export function diasEnTransito(p: PedidoEnvio, umbral = DIAS_TRANSITO_VISIBLE): number | null {
  if (p.estado !== "enviado") return null;
  const d = diasDesdeFecha(p.fecha);
  return d >= umbral ? d : null;
}

/* Lo que la tabla pinta de rojo, y por tanto lo que el contador debe contar.

   Son dos cosas distintas que urgen igual: el pedido viejo que sigue sin salir
   (la regla de los tres días, que vale para todos los canales) y el que tiene el
   plazo del canal ya vencido, aunque sea de ayer —ahí además hay una métrica de
   la plataforma castigándonos—. El KPI contaba solo la primera mitad, así que
   podía haber cinco filas rojas y un "Atrasados: 2". */
export function esUrgente(p: PedidoEnvio, ahora: number): boolean {
  /* Los dos criterios exigen que quede algo por hacer aquí. Un pedido del 14 de
     agosto empacado y esperando la colecta cumplía las dos condiciones y salía
     rojo: la regla de los tres días lo daba por atrasado y el plazo del canal
     por vencido, cuando lo único pendiente era que pasara el transportista. */
  if (!hayTrabajo(p)) return false;
  return esPedidoAtrasado(p.fecha, p.estado) || plazoUrgente(p, ahora) === "vencido";
}

/* Hay que fabricarlo antes de empacarlo: no está en ningún estante, lo está
   haciendo el taller. Ver lib/pedidos/produccion.ts. Recibe el mapa en vez de
   cerrarse sobre él para que el `useMemo` del conteo no se recalcule en cada
   render por una función nueva. */
export function esPersonalizado(p: PedidoEnvio, enProduccion: EnProduccion): boolean {
  return p.id in enProduccion;
}

/* ---------------------------------------------------------------------------
   EL TABLERO DE EMPAQUE

   La mesa de bodega, que es un recorte más estrecho que la bandeja: de lo que
   hay por empacar, lo que de verdad se puede armar hoy con lo que está en el
   estante. Los personalizados no entran —los fabrica el taller y la pantalla ya
   los aparta en su propia tabla— y nada de lo que ya salió, tampoco.

   La excepción es la última columna. Al soltar una tarjeta en "Recolectado" el
   pedido pasa a `enviado` y se saldría de la bandeja: la tarjeta desaparecería
   en el aire, que es exactamente lo que hace dudar de si el arrastre funcionó.
   Así que lo recolectado HOY se queda a la vista, y mañana ya no. Ese "hoy" se
   mide en horario de México (`diaMX`), no en UTC: a las 18:00 del centro ya es
   otro día en Londres y la columna se habría vaciado a media jornada.
   --------------------------------------------------------------------------- */

/* En qué columna va. Sin sello previo, en la primera: un pedido que nadie ha
   tocado está, por definición, esperando a que lo preparen. */
export function etapaDe(p: PedidoEnvio): EtapaEmpaqueId {
  return p.etapa_empaque ?? "preparado";
}

export function entraAlTablero(
  p: PedidoEnvio,
  enProduccion: EnProduccion,
  hoy: string,
): boolean {
  if (esPersonalizado(p, enProduccion)) return false;
  if (bandeja(p) === "por_empacar") return true;
  /* Lo que se acaba de recolectar: sigue en la última columna hasta que cambie
     el día. `etapa_empaque_en` siempre viene con la etapa (la RPC escribe las
     dos a la vez), pero si faltara, no se enseña: una tarjeta sin hora en la
     columna del acuse no tiene forma de salir de ahí nunca. */
  if (p.etapa_empaque !== "recolectado" || !p.etapa_empaque_en) return false;
  return diaMX(p.etapa_empaque_en) === hoy;
}

/* Espejo en TypeScript de `rango_estado_pedido` (migración 20260926000200): en
   qué escalón del viaje va el pedido. Existe solo para que el parche optimista
   del tablero decida IGUAL que la BD si un movimiento avanza el estado o no —si
   discreparan, la tarjeta saltaría de columna al revalidar—. Los finales
   (`cancelado`, `devuelto`) quedan fuera de la escala, como allá. */
export function rangoEstado(e: string | null): number {
  return { nuevo: 0, preparando: 1, enviado: 2, entregado: 3 }[e ?? ""] ?? -1;
}
