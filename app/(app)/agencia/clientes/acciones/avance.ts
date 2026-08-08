"use server";

/* Acciones del avance del proyecto.

   Casi todo lo escribe Fresafit: el estado, los eventos, la bitácora y las
   incidencias son NUESTRO relato de cómo va el trabajo. La única cosa que el
   cliente mueve es el estado de las incidencias que están en su cancha —«ya lo
   estoy viendo»—, y eso pasa por `moverIncidenciaCliente`, que la RLS y el
   trigger `restringir_update_incidencia` acotan a esa única columna. */

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { ESTADOS_INCIDENCIA, LADOS_INCIDENCIA, VISIBILIDADES } from "@/lib/catalogos";
import type { EstadoIncidenciaId, VisibilidadId } from "@/lib/types";

const RUTAS = ["/agencia/clientes", "/portal/avance"];
const revalidar = () => RUTAS.forEach((r) => revalidatePath(r));

/* --------------------------------------------------------------------------
   Estado actual
   -------------------------------------------------------------------------- */
/* Upsert y no update: la fila puede no existir si la empresa se dio de alta
   después de la migración que las sembró. */
export async function guardarEstadoActual(
  empresaId: string,
  estado: string,
): Promise<Resultado> {
  const cx = await exigirRol("interno", "El estado del proyecto lo escribe el equipo de Fresafit.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("empresa_avance").upsert(
    {
      empresa_id: empresaId,
      estado_actual: textoONulo(estado),
      actualizado_por: cx.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "empresa_id" },
  );
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Eventos
   -------------------------------------------------------------------------- */
export async function guardarEvento(datos: {
  id?: string;
  empresa_id: string;
  titulo: string;
  descripcion: string;
  inicia_en: string;
  visibilidad: VisibilidadId;
}): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const titulo = datos.titulo.trim();
  if (!titulo) return { error: "El evento necesita un título." };
  if (!datos.inicia_en) return { error: "El evento necesita fecha y hora." };
  if (!VISIBILIDADES.some((v) => v.id === datos.visibilidad)) {
    return { error: "Ese nivel de visibilidad no existe." };
  }

  const fila = {
    empresa_id: datos.empresa_id,
    titulo,
    descripcion: textoONulo(datos.descripcion),
    inicia_en: datos.inicia_en,
    visibilidad: datos.visibilidad,
  };

  const { error } = datos.id
    ? await cx.supabase.from("empresa_eventos").update(fila).eq("id", datos.id)
    : await cx.supabase.from("empresa_eventos").insert({ ...fila, created_by: cx.user.id });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* Los eventos pasados no se borran: se archivan. El calendario deja de
   enseñarlos y el reporte de periodo los sigue encontrando. */
export async function archivarEvento(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("empresa_eventos")
    .update({ archivado_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Bitácora
   -------------------------------------------------------------------------- */
export async function guardarEntradaBitacora(datos: {
  id?: string;
  empresa_id: string;
  fecha: string;
  titulo: string;
  descripcion: string;
  visibilidad: VisibilidadId;
}): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const titulo = datos.titulo.trim();
  if (!titulo) return { error: "La entrada necesita un título." };

  const fila = {
    empresa_id: datos.empresa_id,
    /* Sin fecha se toma hoy: la entrada de la bitácora se escribe al terminar
       algo, y ese es el caso normal. */
    fecha: datos.fecha || new Date().toISOString().slice(0, 10),
    titulo,
    descripcion: textoONulo(datos.descripcion),
    visibilidad: datos.visibilidad,
  };

  const { error } = datos.id
    ? await cx.supabase.from("empresa_bitacora").update(fila).eq("id", datos.id)
    : await cx.supabase.from("empresa_bitacora").insert({ ...fila, created_by: cx.user.id });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Incidencias
   -------------------------------------------------------------------------- */
export async function guardarIncidencia(datos: {
  id?: string;
  empresa_id: string;
  titulo: string;
  descripcion: string;
  desbloquea: "fresafit" | "cliente";
  impacto: string;
  estado: EstadoIncidenciaId;
  visibilidad: VisibilidadId;
}): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const titulo = datos.titulo.trim();
  if (!titulo) return { error: "La incidencia necesita un título." };
  if (!LADOS_INCIDENCIA.some((l) => l.id === datos.desbloquea)) {
    return { error: "Di de qué lado está el bloqueo." };
  }
  if (!ESTADOS_INCIDENCIA.some((e) => e.id === datos.estado)) {
    return { error: "Ese estado no existe." };
  }

  const fila = {
    empresa_id: datos.empresa_id,
    titulo,
    descripcion: textoONulo(datos.descripcion),
    desbloquea: datos.desbloquea,
    impacto: textoONulo(datos.impacto),
    estado: datos.estado,
    visibilidad: datos.visibilidad,
  };

  const { error } = datos.id
    ? await cx.supabase.from("empresa_incidencias").update(fila).eq("id", datos.id)
    : await cx.supabase.from("empresa_incidencias").insert({ ...fila, created_by: cx.user.id });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* Lo único que mueve el cliente. Solo a «en resolución» o de vuelta a
   «abierta»: dar algo por resuelto es de quien puede comprobar que se
   desbloqueó, y el trigger de la BD lo impone igual. */
export async function moverIncidenciaCliente(
  id: string,
  estado: EstadoIncidenciaId,
): Promise<Resultado> {
  const cx = await exigirRol("cliente");
  if ("error" in cx) return cx;
  if (estado !== "abierta" && estado !== "en_resolucion") {
    return { error: "Avísanos por comentario cuando esté listo y la cerramos." };
  }

  const { error } = await cx.supabase
    .from("empresa_incidencias")
    .update({ estado })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}
