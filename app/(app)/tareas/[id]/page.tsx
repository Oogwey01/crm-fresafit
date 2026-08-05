import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { DetalleTareaPagina } from "@/components/tareas/detalle-pagina";
import type { AgenciaEmpresa, Profile, RolId, TaskConResponsable } from "@/lib/types";

/* Página propia de una tarea. Antes el detalle solo existía como pop-up del
   tablero, que es lo que pidió cambiar Armando ("me gustaría que pueda abrir la
   tarea y que no sea un pop-up"). Además da una URL enlazable, que es lo que
   permite que la campana de avisos lleve a LA tarea y no a /tareas a secas.

   La RLS decide qué tareas ve cada quien; si no la puede ver, no existe para
   ella y se responde 404. */
export default async function TareaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ comentario?: string }>;
}) {
  const { id } = await params;
  const { comentario } = await searchParams;

  const { supabase, user, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [tareaRes, equipoRes, asignadosRes, empresasRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, responsable:profiles!responsable_id(id, nombre, color)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
    /* Aparte del select de la tarea para que la página siga abriendo aunque la
       migración de coasignados no se haya aplicado todavía. */
    supabase
      .from("task_assignees")
      .select("perfil:profiles!user_id(id, nombre, color)")
      .eq("task_id", id),
    /* Los clientes de la agencia: el detalle deja cambiar de cuenta una tarea
       suya. Se piden siempre (son dos filas) para no encadenar otra consulta
       después de saber de qué espacio es la tarea. */
    supabase.from("agencia_empresas").select("id, nombre, color, activa").order("nombre"),
  ]);

  const base = tareaRes.data as unknown as TaskConResponsable | null;
  if (!base) notFound();

  type FilaAsignado = { perfil: Pick<Profile, "id" | "nombre" | "color"> | null };
  type EmpresaChip = Pick<AgenciaEmpresa, "id" | "nombre" | "color">;
  const empresasTodas = (empresasRes.data ?? []) as (EmpresaChip & { activa: boolean })[];
  const empresa = base.empresa_id
    ? (empresasTodas.find((e) => e.id === base.empresa_id) ?? null)
    : null;

  const tarea: TaskConResponsable = {
    ...base,
    empresa,
    coasignados: ((asignadosRes.data ?? []) as unknown as FilaAsignado[])
      .map((a) => a.perfil)
      .filter((p): p is Pick<Profile, "id" | "nombre" | "color"> => Boolean(p)),
  };

  /* Se vuelve al tablero de donde salió la tarea, no siempre al de Fresafit. */
  const volverA = tarea.espacio === "agencia" ? "/agencia/tareas" : "/tareas";

  return (
    <div>
      {/* En el teléfono este enlace lo sustituye la flecha de la barra fija del
          detalle, que además queda pegada al header de navegación. */}
      <Link
        href={volverA}
        className="mb-3 hidden items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground md:inline-flex"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tarea.espacio === "agencia" ? "Volver a tareas de la Agencia" : "Volver a tareas"}
      </Link>
      <DetalleTareaPagina
        tarea={tarea}
        equipo={(equipoRes.data ?? []) as Profile[]}
        rol={rol}
        currentUserId={user?.id ?? ""}
        enfocarComentario={comentario === "1"}
        empresas={empresasTodas.filter((e) => e.activa).map(({ id, nombre, color }) => ({ id, nombre, color }))}
        volverA={volverA}
      />
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await usuarioActual();
  const { data } = await supabase.from("tasks").select("titulo").eq("id", id).maybeSingle();
  return { title: data?.titulo ? `${data.titulo} · Tareas · Fresafit` : "Tarea · Fresafit" };
}
