import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { traerTodo } from "@/lib/canales/paginacion";
import { COLUMNAS_TAREA_CON_RESPONSABLE } from "@/lib/tareas/consulta";
import { esExternoAdmin } from "@/lib/catalogos";
import { BandejasPortal } from "@/components/portal/bandejas";
import type { AgenciaEmpresa, TaskConResponsable } from "@/lib/types";

export const metadata = { title: "Tareas · Tu espacio con Fresafit" };

/* Las dos bandejas del cliente: lo que Fresafit le pide y lo que él nos pide.

   No hay ni un filtro de visibilidad ni de empresa en estas consultas, y no es
   un olvido: la RLS ya solo le devuelve las tareas COMPARTIDAS de SU empresa
   (policy "tareas: ver (externo)", 20260915000000_portal_tareas.sql). Filtrar
   otra vez aquí daría una falsa sensación de que la pantalla es lo que protege
   los datos — y el día que alguien copie esta consulta sin el filtro, se
   enteraría tarde. Lo que la base no da, no llega. */
export default async function PortalTareasPage() {
  await exigirModulo("portal-tareas");

  const { supabase, user, perfil } = await usuarioActual();

  const [tareas, empresaRes, comentarios, companerosRes] = await Promise.all([
    /* Paginado por el corte de PostgREST a ~1000 filas: una cuenta de un año
       pasa ese número, y el recorte no avisa. */
    traerTodo<TaskConResponsable>((desde, hasta) =>
      supabase
        .from("tasks")
        .select(COLUMNAS_TAREA_CON_RESPONSABLE)
        .eq("espacio", "agencia")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(desde, hasta),
    ),
    supabase
      .from("agencia_empresas")
      .select("id, nombre, color, giro")
      .eq("id", perfil?.empresa_id ?? "")
      .maybeSingle(),
    /* Cuántos comentarios tiene cada tarea, para el contador de la lista. Se
       piden todos porque la RLS ya los recortó a los de las tareas visibles. */
    traerTodo<{ task_id: string }>((desde, hasta) =>
      supabase.from("task_comments").select("task_id").order("task_id").range(desde, hasta),
    ).catch(() => [] as { task_id: string }[]),
    /* La gente de MI empresa: es lo que separa las dos bandejas. Desde el
       navegador no se puede deducir —un `created_by` desconocido lo mismo es un
       compañero que alguien de Fresafit—, así que se resuelve aquí. La RLS de
       `profiles` ya solo devuelve a mis compañeros y al equipo de casa. */
    supabase.from("profiles").select("id").eq("empresa_id", perfil?.empresa_id ?? ""),
  ]);

  const empresa = (empresaRes.data ?? null) as Pick<
    AgenciaEmpresa,
    "id" | "nombre" | "color" | "giro"
  > | null;

  const comentariosPorTarea: Record<string, number> = {};
  for (const c of comentarios) comentariosPorTarea[c.task_id] = (comentariosPorTarea[c.task_id] ?? 0) + 1;

  return (
    <BandejasPortal
      tareas={tareas}
      empresa={empresa}
      currentUserId={user?.id ?? ""}
      companeros={(companerosRes.data ?? []).map((p) => p.id)}
      puedeCrear={esExternoAdmin(perfil)}
      comentariosPorTarea={comentariosPorTarea}
    />
  );
}
