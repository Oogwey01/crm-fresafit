/* ============================================================================
   lib/maquila/arranque.ts — Cuándo empieza a correr el reloj del taller
   ----------------------------------------------------------------------------
   La promesa de un pedido de maquila nacía SIEMPRE del pago (lib/maquila/
   ingesta.ts). Para lo de catálogo —la gamuza PRO— eso es correcto: se vende y
   se puede producir. Para un personalizado no, porque falta el arte y eso lo
   entrega otra persona: el pedido le llegaba a Eduardo con días ya consumidos
   por el diseño, y el semáforo lo pintaba en rojo por una demora que no era
   suya.

   Aquí vive la corrección, en UN solo lugar, porque son TRES los caminos que
   sueltan un pedido —el arte subido, el estado «En producción» de la ficha, y
   el marcado a mano desde el detalle— y tres cálculos distintos de la misma
   fecha acabarían divergiendo.

   Las reglas NO se reimplementan: `arranqueDePedido` decide el instante y
   `clasificarPago` deriva ruta, corte y promesa, exactamente igual que la
   ingesta. Lo único que cambia es desde cuándo se cuenta.

   LO QUE NO TOCA: la tarifa. El costo por pieza depende de modelo + acabado y
   de la fecha de PAGO (maquila_fijar_costo_pedido), y el pago no se movió;
   refijarlo aquí congelaría un precio distinto al pactado en la venta.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { traerPorLotes } from "@/lib/supabase/lotes";
import { diaMX, horaMX } from "@/lib/fecha";
import { arranqueDePedido, clasificarPago } from "@/lib/maquila/reglas";
import { cargarCalendarioMaquila } from "@/lib/maquila/consultas";

type Cliente = SupabaseClient<Database>;

type PedidoArranque = {
  id: string;
  acabado: string;
  pagado_en: string | null;
  personalizado_id: string | null;
  diseno_id: string | null;
  diseno_listo_en: string | null;
};

/* Recalcula ruta, corte y fecha prometida de los pedidos indicados desde su
   arranque real. Los que todavía no arrancan (sin arte, o sin pago) se quedan
   como están: no hay desde cuándo contar, y borrarles la promesa dejaría al
   tablero sin poder ordenar por urgencia.

   Devuelve cuántos pedidos quedaron reclasificados. **NUNCA lanza**, y eso es
   deliberado: siempre corre DESPUÉS de que quien llama ya guardó lo que
   importaba —el arte subido, el estado de la ficha—, y una promesa que no se
   pudo mover no puede tirar esa operación ni dejar el archivo huérfano. Si
   falla, la fecha se corrige sola al reeditar el pedido. */
export async function recalcularArranqueMaquila(
  supabase: Cliente,
  pedidoIds: string[],
): Promise<number> {
  if (pedidoIds.length === 0) return 0;

  try {
    const pedidos = await traerPorLotes<string, PedidoArranque>(pedidoIds, (lote) =>
      supabase
        .from("maquila_pedidos")
        .select("id, acabado, pagado_en, personalizado_id, diseno_id, diseno_listo_en")
        .in("id", lote),
    );
    if (pedidos.length === 0) return 0;

    /* El calendario se carga UNA vez para toda la tanda: dos pedidos hermanos
       de la misma orden tienen que clasificar igual. */
    const { cal } = await cargarCalendarioMaquila(supabase);

    let hechos = 0;
    for (const p of pedidos) {
      const arranque = arranqueDePedido(p);
      if (!arranque) continue;

      const cls = clasificarPago(diaMX(arranque), horaMX(arranque), p.acabado, cal);
      const { error } = await supabase
        .from("maquila_pedidos")
        .update({
          ruta: cls.ruta,
          corte_fecha: cls.corteFecha,
          fecha_prometida: cls.fechaPrometida,
        })
        .eq("id", p.id);
      if (!error) hechos++;
    }
    return hechos;
  } catch (e) {
    console.error("[maquila] recalcular arranque:", e);
    return 0;
  }
}
