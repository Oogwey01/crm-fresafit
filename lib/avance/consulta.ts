/* ============================================================================
   lib/avance/consulta.ts — Leer el avance de un proyecto
   ----------------------------------------------------------------------------
   Igual que documentos: una sola consulta para las dos caras, y la RLS decide
   qué llega a cada quien. Aquí no hay ni un filtro por visibilidad — si lo
   hubiera, sería una segunda regla que se puede desincronizar de la primera.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { traerTodo } from "@/lib/canales/paginacion";
import { ESTADOS_CERRADOS } from "@/lib/catalogos";
import type {
  EmpresaAvance,
  EmpresaBitacoraConAutor,
  EmpresaEvento,
  EmpresaIncidencia,
  Profile,
  TaskConResponsable,
} from "@/lib/types";

type Cliente = SupabaseClient<Database>;

export const COLUMNAS_EVENTO =
  "id, empresa_id, titulo, descripcion, inicia_en, visibilidad, archivado_at," +
  " created_by, created_at, updated_at";

export const COLUMNAS_BITACORA =
  "id, empresa_id, fecha, titulo, descripcion, visibilidad, created_by, created_at, updated_at";

export const COLUMNAS_INCIDENCIA =
  "id, empresa_id, titulo, descripcion, desbloquea, impacto, detectada_en, estado," +
  " resuelta_en, visibilidad, created_by, created_at, updated_at";

export type AvanceCompleto = {
  avance: EmpresaAvance | null;
  eventos: EmpresaEvento[];
  bitacora: EmpresaBitacoraConAutor[];
  incidencias: EmpresaIncidencia[];
};

/* Todo el avance de una empresa. `rango` acota la bitácora (el reporte de
   periodo y el filtro de fechas del portal); los eventos y las incidencias van
   completos porque son «lo que viene» y «lo que estorba», que no tienen periodo:
   una incidencia de hace tres meses sigue estorbando hoy. */
export async function avanceDeEmpresa(
  supabase: Cliente,
  empresaId: string,
  rango?: { desde?: string; hasta?: string },
): Promise<AvanceCompleto> {
  const [avanceRes, eventos, bitacora, incidencias] = await Promise.all([
    supabase
      .from("empresa_avance")
      .select("empresa_id, estado_actual, actualizado_por, updated_at")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    traerTodo<EmpresaEvento>((desde, hasta) =>
      supabase
        .from("empresa_eventos")
        .select(COLUMNAS_EVENTO)
        .eq("empresa_id", empresaId)
        .is("archivado_at", null)
        .order("inicia_en", { ascending: true })
        .order("id")
        .range(desde, hasta),
    ),
    traerTodo<EmpresaBitacoraConAutor>((desde, hasta) => {
      let q = supabase
        .from("empresa_bitacora")
        .select(`${COLUMNAS_BITACORA}, autor:profiles!created_by(id, nombre, color)`)
        .eq("empresa_id", empresaId);
      if (rango?.desde) q = q.gte("fecha", rango.desde);
      if (rango?.hasta) q = q.lte("fecha", rango.hasta);
      /* Desempate por id: las entradas de un mismo día se repiten y sin criterio
         único la paginación puede saltarse o repetir filas. */
      return q.order("fecha", { ascending: false }).order("id").range(desde, hasta);
    }),
    traerTodo<EmpresaIncidencia>((desde, hasta) =>
      supabase
        .from("empresa_incidencias")
        .select(COLUMNAS_INCIDENCIA)
        .eq("empresa_id", empresaId)
        .order("detectada_en", { ascending: false })
        .order("id")
        .range(desde, hasta),
    ),
  ]);

  return {
    avance: (avanceRes.data ?? null) as EmpresaAvance | null,
    eventos,
    bitacora,
    incidencias,
  };
}

/* Los pendientes de cada lado.

   NO hay tabla: son las tareas compartidas abiertas, partidas por quién las
   pidió. Duplicarlas en una tabla propia daría dos listas que se contradicen a
   la semana — y la pregunta «¿qué falta de tu lado?» ya la contesta el tablero.

   `idsDelCliente` son los perfiles de esa empresa; lo que abrió alguien de ahí
   nos toca a nosotros, y al revés. */
export function pendientesPorLado(
  tareas: TaskConResponsable[],
  idsDelCliente: Set<string>,
): { deFresafit: TaskConResponsable[]; delCliente: TaskConResponsable[] } {
  const deFresafit: TaskConResponsable[] = [];
  const delCliente: TaskConResponsable[] = [];

  for (const t of tareas) {
    if (t.visibilidad !== "compartido") continue;
    if (ESTADOS_CERRADOS.includes(t.estado as (typeof ESTADOS_CERRADOS)[number])) continue;
    if (t.deleted_at) continue;
    /* La abrió el cliente → nos toca a nosotros resolverla. */
    (idsDelCliente.has(t.created_by ?? "") ? deFresafit : delCliente).push(t);
  }

  return { deFresafit, delCliente };
}

/* El perfil de quien escribió cada cosa, para pintar la bitácora sin un embed
   por tabla. */
export type Autor = Pick<Profile, "id" | "nombre" | "color">;
