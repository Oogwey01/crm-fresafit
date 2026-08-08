/* ============================================================================
   lib/actividad.ts — El registro del módulo de empresas
   ----------------------------------------------------------------------------
   Este módulo no es solo organización: es evidencia. El día que se discuta si se
   pidió la constancia fiscal, cuándo se pidió y si se entregó, `actividad_empresas`
   es lo que cierra la conversación. Por eso la tabla no admite UPDATE ni DELETE
   —ni para dirección— y por eso esto no borra nunca nada: solo escribe.

   Casi todo lo registra la BASE, por trigger (crear una tarea, moverla, cambiar
   su visibilidad, subir un documento). Un trigger no se olvida, y lo que se
   discute meses después es justo lo que a nadie se le ocurrió registrar.

   Esta función es para lo que NO pasa por una escritura en tabla y por tanto
   ningún trigger puede ver:
     * descargar un documento — no cambia nada, y es media discusión de «yo nunca
       recibí eso»;
     * exportar el reporte de un periodo;
     * entrar al portal.

   Es informativo respecto a la acción principal: si el insert falla, se avisa por
   consola y la acción sigue. Perder un renglón del registro es malo; tumbarle la
   descarga a un cliente por eso, peor.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/tipos-bd";

/* Sirve igual el cliente con sesión (lib/supabase/server) que el de servicio
   (lib/supabase/admin): los dos son el mismo tipo con el esquema generado. */
type Cliente = SupabaseClient<Database>;

/* El vocabulario del registro. Cerrado a propósito: una cadena suelta por
   llamada convierte el expediente en algo que no se puede filtrar ni contar.
   Los que llevan sufijo los escribe un trigger; los de aquí, esta función. */
export type AccionActividad =
  | "login"
  | "documento_descargado"
  | "documento_visto"
  | "reporte_exportado";

export async function registrarActividadEmpresa(
  supabase: Cliente,
  datos: {
    empresaId: string | null;
    actorId: string;
    actorNombre?: string | null;
    accion: AccionActividad;
    entidad?: string | null;
    entidadId?: string | null;
    detalle?: Json | null;
  },
): Promise<void> {
  const { error } = await supabase.from("actividad_empresas").insert({
    empresa_id: datos.empresaId,
    actor_id: datos.actorId,
    actor_nombre: datos.actorNombre ?? null,
    accion: datos.accion,
    entidad: datos.entidad ?? null,
    entidad_id: datos.entidadId ?? null,
    detalle: datos.detalle ?? null,
  });
  if (error) console.warn("[actividad] no se pudo registrar:", error.message);
}

/* Cada cuánto se anota que alguien entró.

   Un renglón por carga de página convertiría el expediente en ruido: lo que
   interesa es «entró el martes», no las cuarenta navegaciones de ese martes. Ocho
   horas es una jornada: si vuelve al día siguiente, queda otro renglón. */
export const HORAS_ENTRE_LOGINS = 8;

/* Deja constancia de la visita, si no hay una reciente de la misma persona.

   La comprobación cuesta una consulta por carga del portal, con índice por
   (actor_id, created_at desc) — que existe justo para esto. Se hace con la
   sesión de quien mira, así que la RLS aplica: OJO, la policy de lectura de
   `actividad_empresas` es solo de dirección, de modo que a un cliente la
   consulta le devuelve vacío y siempre escribiría. Por eso el conteo va con el
   cliente ADMIN que se le pase, no con el de sesión. */
export async function registrarVisita(
  supabaseAdmin: Cliente,
  datos: { empresaId: string | null; actorId: string; actorNombre?: string | null },
): Promise<void> {
  const desde = new Date(Date.now() - HORAS_ENTRE_LOGINS * 3600_000).toISOString();

  const { count, error } = await supabaseAdmin
    .from("actividad_empresas")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", datos.actorId)
    .eq("accion", "login")
    .gte("created_at", desde);

  /* Si no se pudo consultar, no se registra: repetir el renglón en cada
     navegación ensuciaría el expediente más de lo que lo ayuda perderse uno. */
  if (error) {
    console.warn("[actividad] no se pudo comprobar la visita:", error.message);
    return;
  }
  if ((count ?? 0) > 0) return;

  await registrarActividadEmpresa(supabaseAdmin, {
    ...datos,
    accion: "login",
    entidad: "portal",
  });
}
