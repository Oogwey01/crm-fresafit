/* ============================================================================
   lib/avance/reporte.ts — Armar el reporte de periodo
   ----------------------------------------------------------------------------
   Lo comparten las dos rutas de impresión: la del equipo
   (/agencia/clientes/[slug]/imprimir) y la del cliente (/portal/avance/imprimir).
   Son dos rutas y no una porque cada lado entra por su espacio —el layout de
   /agencia expulsa a los externos—, pero el reporte es EL MISMO: esta función
   es la garantía de que ambas imprimen idéntica consulta, y la RLS de la sesión
   de quien mira decide qué llega.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { traerTodo } from "@/lib/canales/paginacion";
import { COLUMNAS_TAREA_CON_RESPONSABLE } from "@/lib/tareas/consulta";
import { avanceDeEmpresa, pendientesPorLado, type AvanceCompleto } from "@/lib/avance/consulta";
import type { TaskConResponsable } from "@/lib/types";

type Cliente = SupabaseClient<Database>;

export type ReportePeriodo = {
  datos: AvanceCompleto;
  cerradas: TaskConResponsable[];
  pendientes: { deFresafit: TaskConResponsable[]; delCliente: TaskConResponsable[] };
};

export async function armarReportePeriodo(
  supabase: Cliente,
  empresaId: string,
  rango: { desde: string; hasta: string },
): Promise<ReportePeriodo> {
  const [datos, tareas, contactosRes] = await Promise.all([
    avanceDeEmpresa(supabase, empresaId, rango),
    traerTodo<TaskConResponsable>((d, h) =>
      supabase
        .from("tasks")
        .select(COLUMNAS_TAREA_CON_RESPONSABLE)
        .eq("espacio", "agencia")
        .eq("empresa_id", empresaId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .order("id")
        .range(d, h),
    ),
    supabase.from("profiles").select("id").eq("empresa_id", empresaId),
  ]);

  /* Cerradas DENTRO del rango, por su última actividad: es la aproximación de
     «cuándo se terminó» sin una columna dedicada, y para un reporte de junta es
     exactamente lo que se quiere contar. */
  const enRango = (t: TaskConResponsable) => {
    const fecha = (t.ultima_actividad_at ?? t.updated_at ?? t.created_at).slice(0, 10);
    return fecha >= rango.desde && fecha <= rango.hasta;
  };
  const cerradas = tareas.filter(
    (t) => (t.estado === "hecho" || t.estado === "cancelada") && enRango(t),
  );

  const idsDelCliente = new Set((contactosRes.data ?? []).map((p) => p.id));

  return { datos, cerradas, pendientes: pendientesPorLado(tareas, idsDelCliente) };
}

/* El rango que piden las dos rutas: validado, ordenado y con el mes en curso
   como default. */
export function rangoDeParams(
  params: { desde?: string; hasta?: string },
  hoy: string,
): { desde: string; hasta: string } {
  const esFecha = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const desde = esFecha(params.desde) ? params.desde : hoy.slice(0, 8) + "01";
  const hasta = esFecha(params.hasta) ? params.hasta : hoy;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}
