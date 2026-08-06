/* ============================================================================
   lib/inventario/origenes.ts — Vocabulario de los movimientos de stock
   ----------------------------------------------------------------------------
   El `origen` de `stock_log` dice QUÉ provocó un cambio de stock. Se pinta en
   tres pantallas (el historial completo, la ficha de un producto y el monitor
   del piloto) y hasta ahora cada una traía su propio diccionario: la misma cosa
   se llamaba «Sync Tienda Nube» en una y «Igualado con Tienda Nube» en otra, a
   `recepcion_bodega` no la nombraba ninguna —salía el nombre crudo, siendo de
   los pocos movimientos con piezas de verdad detrás— y al monitor del piloto le
   faltaban la mitad. Aquí vive la única versión.

   LA DISTINCIÓN QUE IMPORTA es `clase`:

   - `real`         → alguien o algo movió PIEZAS. Una venta, una cancelación,
                      mercancía que llegó, un ajuste a mano.
   - `puesta_al_dia`→ nadie movió nada: el CRM copió el número que ya tenía el
                      canal. Es cómo se entera de las ventas de Tienda Nube
                      mientras el CRM no gobierne el stock, así que NO es ruido
                      —es el mecanismo—, pero son el 93% de los renglones y
                      sepultan a los demás. Por eso la pantalla abre en `real` y
                      deja estos a un clic.

   Dos criterios que conviene no re-discutir cada vez:

   - `reparacion` es REAL. Aunque la decida el sistema, cambia el número de
     verdad y es rarísima (2 renglones en 30 días): esconderla sería esconder
     justo lo que hay que auditar.
   - `tiktok_stock` es PUESTA AL DÍA aunque no acabe en `_sync`: la escribe la
     pasada nocturna en lote y es una observación de lo que TikTok reporta, no
     una operación del CRM. Las ventas de TikTok tienen su propio renglón.
   ============================================================================ */

export type ClaseMovimiento = "real" | "puesta_al_dia";

export type DefinicionOrigen = {
  /* Historial completo: frase legible por alguien que no conoce el sistema. */
  etiqueta: string;
  /* Ficha del producto y monitor del piloto, donde el espacio es de una línea. */
  corto: string;
  /* Qué significa, al pasar el cursor. */
  descripcion: string;
  clase: ClaseMovimiento;
  /* ¿Hay SIEMPRE una persona detrás? Sirve para leer bien la ausencia de firma:
     en una venta por webhook «sin autor» significa que no hubo nadie; en un
     ajuste manual significa que es anterior a que se guardara el quién (agosto
     de 2026), y llamarlo «automático» sería mentira. */
  humano: boolean;
};

const ORIGENES: Record<string, DefinicionOrigen> = {
  /* ---------------------------- Movimientos reales ---------------------------- */
  manual: {
    etiqueta: "Ajuste manual",
    corto: "ajuste",
    descripcion: "Alguien cambió el stock a mano con los botones +/− del CRM.",
    clase: "real",
    humano: true,
  },
  proveedor: {
    etiqueta: "Llegó pedido a proveedor",
    corto: "proveedor",
    descripcion: "Se recibió un pedido a proveedor y sus piezas se sumaron al stock.",
    clase: "real",
    humano: true,
  },
  recepcion_bodega: {
    etiqueta: "Recepción en bodega",
    corto: "recepción",
    descripcion:
      "Se checó un renglón de una recepción en bodega y sus piezas se sumaron al stock.",
    clase: "real",
    humano: true,
  },
  /* Armar es un asiento doble: los renglones de las piezas y el de la ficha del
     conjunto comparten `lote`, así que en la tabla salen como un solo bloque. El
     desarme lleva su propio origen y no solo la flecha al revés: en el historial
     hay que poder leer «esto fue una corrección» de un vistazo. */
  conjunto_armado: {
    etiqueta: "Se armó un conjunto",
    corto: "armado",
    descripcion:
      "Bodega armó conjuntos: se descontaron sus piezas y se le acreditaron al SKU del conjunto.",
    clase: "real",
    humano: true,
  },
  conjunto_desarmado: {
    etiqueta: "Se deshizo un armado",
    corto: "desarme",
    descripcion:
      "Se revirtió un armado de conjuntos: las piezas volvieron al inventario y el SKU del conjunto bajó.",
    clase: "real",
    humano: true,
  },
  venta_tn: {
    etiqueta: "Venta en Tienda Nube",
    corto: "venta TN",
    descripcion: "Se vendió en Tienda Nube y se descontó del stock.",
    clase: "real",
    humano: false,
  },
  venta_ml: {
    etiqueta: "Venta en Mercado Libre",
    corto: "venta ML",
    descripcion: "Se vendió en Mercado Libre y se descontó del stock.",
    clase: "real",
    humano: false,
  },
  venta_tiktok: {
    etiqueta: "Venta en TikTok",
    corto: "venta TikTok",
    descripcion:
      "Se vendió en TikTok y se descontó del inventario de TikTok. El stock de bodega no se toca: son almacenes distintos.",
    clase: "real",
    humano: false,
  },
  cancelacion_tn: {
    etiqueta: "Venta cancelada (Tienda Nube)",
    corto: "cancelación TN",
    descripcion: "Se canceló una venta de Tienda Nube y sus piezas volvieron al stock.",
    clase: "real",
    humano: false,
  },
  cancelacion_ml: {
    etiqueta: "Venta cancelada (Mercado Libre)",
    corto: "cancelación ML",
    descripcion: "Se canceló una venta de Mercado Libre y sus piezas volvieron al stock.",
    clase: "real",
    humano: false,
  },
  cancelacion_tiktok: {
    etiqueta: "Venta cancelada (TikTok)",
    corto: "cancelación TikTok",
    descripcion:
      "Se canceló una venta de TikTok y sus piezas volvieron al inventario de TikTok.",
    clase: "real",
    humano: false,
  },
  reembolso_tn: {
    etiqueta: "Venta reembolsada (Tienda Nube)",
    corto: "reembolso TN",
    descripcion:
      "Tienda Nube marcó la orden como reembolsada: la venta sí ocurrió y se devolvió el dinero, así que sus piezas vuelven al stock.",
    clase: "real",
    humano: false,
  },
  reparacion: {
    etiqueta: "Corrección automática",
    corto: "corrección",
    descripcion:
      "El sistema detectó un desfase que llevaba dos revisiones sin moverse y corrigió el stock hacia la fuente de verdad.",
    clase: "real",
    humano: false,
  },

  /* ---------------------------- Puestas al día ------------------------------- */
  tiendanube_sync: {
    etiqueta: "Igualado con Tienda Nube",
    corto: "sync TN",
    descripcion:
      "La pasada automática igualó el stock del CRM al que tenía Tienda Nube en ese momento. No es una venta: solo se pusieron de acuerdo los números.",
    clase: "puesta_al_dia",
    humano: false,
  },
  mercadolibre_sync: {
    etiqueta: "Igualado con Mercado Libre",
    corto: "sync ML",
    descripcion:
      "La pasada automática igualó el stock del CRM al que tenía Mercado Libre en ese momento. No es una venta.",
    clase: "puesta_al_dia",
    humano: false,
  },
  tiktok_sync: {
    etiqueta: "Igualado con TikTok",
    corto: "sync TikTok",
    descripcion:
      "La pasada automática igualó el stock del CRM al que tenía TikTok en ese momento. No es una venta.",
    clase: "puesta_al_dia",
    humano: false,
  },
  tiktok_stock: {
    etiqueta: "Stock de TikTok",
    corto: "stock TikTok",
    descripcion:
      "Cambió el inventario de la publicación de TikTok. El almacén de TikTok es aparte del de bodega: este renglón NO tocó el stock del CRM, solo deja constancia de lo que TikTok reportó.",
    clase: "puesta_al_dia",
    humano: false,
  },
};

/* Un origen desconocido cae en «real» A PROPÓSITO: el día que alguien escriba
   una etiqueta nueva debe APARECER en la vista por defecto, no desaparecer de
   ella. Se ve con su nombre crudo, que es feo pero visible —justo la señal de
   que hay que darlo de alta aquí—. */
export function origenDe(origen: string): DefinicionOrigen {
  return (
    ORIGENES[origen] ?? {
      etiqueta: origen,
      corto: origen,
      descripcion: "",
      clase: "real",
      humano: false,
    }
  );
}

export function etiquetaOrigen(origen: string): string {
  return origenDe(origen).etiqueta;
}

export function cortoOrigen(origen: string): string {
  return origenDe(origen).corto;
}

/* Vacía cuando no hay nada que explicar: la UI la usa para decidir si pone el
   subrayado punteado de «pasa el cursor». */
export function descripcionOrigen(origen: string): string | undefined {
  return origenDe(origen).descripcion || undefined;
}

export function esPuestaAlDia(origen: string): boolean {
  return origenDe(origen).clase === "puesta_al_dia";
}

export function esOrigenHumano(origen: string): boolean {
  return origenDe(origen).humano;
}

/* Se deriva de la tabla de arriba, no se escribe a mano: dos listas que
   mantener acaban desincronizándose, que es de lo que este módulo viene a
   curar. */
export const ORIGENES_PUESTA_AL_DIA: readonly string[] = Object.entries(ORIGENES)
  .filter(([, d]) => d.clase === "puesta_al_dia")
  .map(([o]) => o);

/* La forma exacta que PostgREST espera en un `not.in`: ("a","b"). supabase-js
   entrecomilla solo la lista de `.in()`, pero en `.not(col, "in", …)` el valor
   viaja tal cual, así que hay que armarlo aquí. */
export const FILTRO_PUESTA_AL_DIA = `(${ORIGENES_PUESTA_AL_DIA.map((o) => `"${o}"`).join(",")})`;

/* Cuántos renglones se traen de cada vista. El tope se aplica ANTES de filtrar
   por canal, así que en los movimientos reales tiene que ser holgado: con ~70 al
   mes y 90 días de retención (ver 20260830000000_retencion_logs.sql), 250 cubre
   todo lo que hay y el filtro nunca miente. Las puestas al día llegan en lotes
   de decenas y son para auditar los últimos días, no el trimestre. */
export const LIMITE_MOVIMIENTOS = 250;
export const LIMITE_PUESTAS_AL_DIA = 200;
