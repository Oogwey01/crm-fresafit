"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { revalidar } from "@/app/(app)/maquila/acciones/comun";
import type {
  DestinoIncidenciaMaquilaId,
  IncidenciaMaquila,
  TipoIncidenciaMaquilaId,
} from "@/lib/types";

/* Los pendientes de un pedido, en los dos sentidos. Abrir es nivel "maquila"
   —Eduardo también reporta: que le falta material, que el arte no se entiende,
   que su imprenta lo dejó colgado—; resolver es del equipo, porque cerrar un
   pendiente que te reclaman a ti no es tuyo. La RLS lo vuelve a exigir. */

export async function abrirIncidenciaMaquila(
  pedidoId: string,
  input: { tipo: TipoIncidenciaMaquilaId; dirigida_a: DestinoIncidenciaMaquilaId; texto: string },
): Promise<Resultado> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  const texto = input.texto.trim();
  if (!texto) return { error: "Escribe qué pasó." };

  const { error } = await cx.supabase.from("maquila_incidencias").insert({
    pedido_id: pedidoId,
    tipo: input.tipo,
    dirigida_a: input.dirigida_a,
    texto,
    created_by: cx.user.id,
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function resolverIncidenciaMaquila(
  incidenciaId: string,
  respuesta: string,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_incidencias")
    .update({
      abierta: false,
      resuelta_en: new Date().toISOString(),
      resuelta_por: cx.user.id,
      respuesta: textoONulo(respuesta),
    })
    .eq("id", incidenciaId);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Las de un pedido, para el diálogo. Con el nombre de quien la abrió: el join
   a profiles pasa por la RLS de la sesión, igual que en el historial. */
export async function listarIncidenciasMaquila(
  pedidoId: string,
): Promise<Resultado<{ incidencias: IncidenciaMaquila[] }>> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("maquila_incidencias")
    .select(
      "id, pedido_id, tipo, dirigida_a, texto, abierta, resuelta_en, resuelta_por," +
        " respuesta, created_by, created_at, autor_perfil:profiles!created_by(nombre)",
    )
    .eq("pedido_id", pedidoId)
    .order("abierta", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { error: error.message };

  type Fila = IncidenciaMaquila & { autor_perfil: { nombre: string } | null };
  const incidencias = ((data ?? []) as unknown as Fila[]).map(({ autor_perfil, ...i }) => ({
    ...i,
    autor_nombre: autor_perfil?.nombre ?? null,
  }));
  return { ok: true, datos: { incidencias } };
}
