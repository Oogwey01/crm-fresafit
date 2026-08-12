/* ============================================================================
   lib/maquila/enlace-personalizados.ts — Que el arte llegue solo al tablero
   ----------------------------------------------------------------------------
   Cuando el diseñador sube el arte de un personalizado, Eduardo tiene que
   enterarse SIN que nadie se acuerde de ir a ligar el pedido a mano. Eso es lo
   que hace este módulo, y son dos cosas distintas:

     1. LIGAR el pedido de maquila al personalizado (`personalizado_id`). Es lo
        que le abre a Eduardo la imagen: la policy del bucket `personalizados`
        se la concede solo si existe esa liga y el pedido ya está pagado
        (maquilero_ve_personalizado, 20261002000000).
     2. Marcar `diseno_listo_en`: «el arte quedó entregado, el reloj corre para
        el taller». Subir la foto ES entregar el arte.

   POR QUÉ NO LIGA SIEMPRE. `sugerirPersonalizados` PROPONE y no aplica, con
   razón: un cruce por texto no es una certeza, y ligar mal significa que
   Eduardo borda el diseño de otro cliente. Aquí solo se liga cuando no hay nada
   que adivinar — un único pedido candidato, sin arte previo. Con dos candidatos
   (una orden con dos cinturones personalizados distintos) NO se toca nada y la
   liga se queda para el detalle del pedido, que es donde se ve cuál es cuál.

   El cruce, en orden de confianza:
     · `personalizados.sale_order_id` → `sale_orders` → (canal, referencia_orden).
       Es una FK, no texto (20261006000000_personalizados_venta).
     · `no_venta` = `numero_orden`, comparando el folio ya normalizado. Es el
       respaldo para las fichas viejas, que se capturaron a mano.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { ESTADOS_MAQUILA_ACTIVOS } from "@/lib/catalogos";

type Cliente = SupabaseClient<Database>;

export type ResumenEnlaceArte = {
  /* Pedidos a los que se les acaba de colgar el personalizado. */
  ligados: number;
  /* Pedidos que quedaron marcados con el arte listo. */
  marcados: number;
  /* Había pedidos que podían ser, pero más de uno: nadie puede decidir por el
     equipo cuál lleva este diseño. */
  ambiguo: boolean;
};

/* El folio, como lo teclea la gente: "#1042", " 1042 " y "1042" son el mismo.
   No se tocan los ceros a la izquierda — en Tienda Nube "0042" y "42" son
   folios distintos. */
function folio(v: string | null | undefined): string {
  return (v ?? "").trim().replace(/^#/, "");
}

/* Los pedidos que este personalizado podría estar describiendo: mismos canal y
   orden, todavía en producción y sin arte de otro origen. */
async function candidatos(
  supabase: Cliente,
  personalizado: { no_venta: string | null; sale_order_id: string | null },
): Promise<{ id: string }[]> {
  const base = () =>
    supabase
      .from("maquila_pedidos")
      .select("id")
      .is("personalizado_id", null)
      .is("diseno_id", null)
      .in("estado", [...ESTADOS_MAQUILA_ACTIVOS])
      .limit(5);

  /* 1) Por la orden ligada de verdad. */
  if (personalizado.sale_order_id) {
    const { data: orden } = await supabase
      .from("sale_orders")
      .select("canal, referencia_orden")
      .eq("id", personalizado.sale_order_id)
      .single();
    if (orden?.referencia_orden) {
      const { data } = await base()
        .eq("canal", orden.canal)
        .eq("referencia_orden", orden.referencia_orden);
      if (data?.length) return data as { id: string }[];
    }
  }

  /* 2) Por el folio tecleado. Igualdad exacta, no el `ilike %x%` de
     sugerirPersonalizados: aquí se va a ESCRIBIR, no a proponer, y "42" no
     puede arrastrar al pedido "1042". */
  const numero = folio(personalizado.no_venta);
  if (!numero) return [];
  const { data } = await base().eq("numero_orden", numero);
  return (data ?? []) as { id: string }[];
}

/* Llamar después de guardar el arte de un personalizado. No lanza: el arte ya
   quedó guardado y esto es la cortesía de avisarle al tablero — si falla, la
   liga se hace a mano desde el detalle del pedido, como antes. */
export async function propagarArteDePersonalizado(
  supabase: Cliente,
  personalizadoId: string,
  usuarioId: string,
): Promise<ResumenEnlaceArte> {
  const salida: ResumenEnlaceArte = { ligados: 0, marcados: 0, ambiguo: false };

  const { data: ligados } = await supabase
    .from("maquila_pedidos")
    .select("id, diseno_listo_en")
    .eq("personalizado_id", personalizadoId);

  let porMarcar = (ligados ?? []) as { id: string; diseno_listo_en: string | null }[];

  /* Nadie lo ligó todavía: se intenta, pero solo si no hay nada que adivinar. */
  if (porMarcar.length === 0) {
    const { data: p } = await supabase
      .from("personalizados")
      .select("no_venta, sale_order_id")
      .eq("id", personalizadoId)
      .single();
    if (!p) return salida;

    const posibles = await candidatos(supabase, p as { no_venta: string | null; sale_order_id: string | null });
    if (posibles.length > 1) {
      salida.ambiguo = true;
      return salida;
    }
    if (posibles.length === 1) {
      const { error } = await supabase
        .from("maquila_pedidos")
        .update({ personalizado_id: personalizadoId })
        .eq("id", posibles[0].id)
        .is("personalizado_id", null); // carrera: si alguien lo ligó primero, gana él
      if (error) return salida;
      salida.ligados = 1;
      porMarcar = [{ id: posibles[0].id, diseno_listo_en: null }];
    }
  }

  /* El arte entregado marca el pedido. Solo los que no lo estaban: volver a
     subir una corrección no reinicia el reloj del taller. */
  const nuevos = porMarcar.filter((p) => !p.diseno_listo_en).map((p) => p.id);
  if (nuevos.length > 0) {
    const { error } = await supabase
      .from("maquila_pedidos")
      .update({ diseno_listo_en: new Date().toISOString(), diseno_listo_por: usuarioId })
      .in("id", nuevos);
    if (!error) salida.marcados = nuevos.length;
  }
  return salida;
}
