"use server";

/* Leer el expediente de una empresa. Solo dirección — la RLS de
   `actividad_empresas` ya lo impone (SELECT = es_admin), esto es el mensaje con
   palabras y el no-viaje para quien no toca. */

import { exigirRol } from "@/lib/supabase/guardia";
import { traerTodo } from "@/lib/canales/paginacion";

export type FilaActividad = {
  id: number;
  empresa_id: string | null;
  actor_id: string | null;
  actor_nombre: string | null;
  accion: string;
  entidad: string | null;
  entidad_id: string | null;
  detalle: Record<string, unknown> | null;
  created_at: string;
};

/* El expediente completo de una empresa, del más reciente al más viejo. Va por
   action y no en la carga de la página para que el resto de las pestañas no
   paguen su peso: la actividad crece sin tope (a propósito — no se poda) y solo
   dirección la abre. */
export async function cargarActividad(empresaId: string): Promise<FilaActividad[]> {
  const cx = await exigirRol("direccion", "El registro de actividad es de dirección.");
  if ("error" in cx) throw new Error(cx.error);

  return traerTodo<FilaActividad>((desde, hasta) =>
    cx.supabase
      .from("actividad_empresas")
      .select("id, empresa_id, actor_id, actor_nombre, accion, entidad, entidad_id, detalle, created_at")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(desde, hasta),
  );
}
