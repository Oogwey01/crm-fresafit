"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import type { EstadoPedidoId } from "@/lib/types";

const RUTAS = ["/pedidos", "/metricas", "/clientes"];
const revalidar = () => RUTAS.forEach((r) => revalidatePath(r));

/* Cambio de estado del pedido en línea (nuevo → preparando → enviado → …). */
export async function cambiarEstadoPedido(id: string, estado: EstadoPedidoId): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede mover pedidos.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("sales").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Guardar paquetería y número de guía (y opcionalmente marcar enviado). */
export async function guardarEnvio(
  id: string,
  paqueteria: string,
  numGuia: string,
): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede editar envíos.");
  if ("error" in cx) return cx;

  /* Se borra la URL de rastreo que hubiera dado el canal: apuntaba a la guía
     anterior, y un enlace que lleva al paquete equivocado es peor que ninguno.
     Sin ella, el CRM la deriva de la paquetería (lib/pedidos/rastreo.ts). */
  const { error } = await cx.supabase
    .from("sales")
    .update({
      paqueteria: textoONulo(paqueteria),
      num_guia: textoONulo(numGuia),
      url_rastreo: null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
