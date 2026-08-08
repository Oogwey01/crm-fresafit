import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { equipoCompleto } from "@/lib/supabase/consultas";
import { traerTodo } from "@/lib/canales/paginacion";
import { COLUMNAS_TAREA_CON_RESPONSABLE } from "@/lib/tareas/consulta";
import { documentosDeEmpresa } from "@/lib/documentos/consulta";
import { avanceDeEmpresa, pendientesPorLado } from "@/lib/avance/consulta";
import { hoyISO } from "@/lib/fecha";
import { EspacioCliente } from "@/components/agencia-clientes/espacio-cliente";
import type { AgenciaEmpresa, Profile, RolId, TaskConResponsable } from "@/lib/types";

/* El espacio de trabajo con UN cliente, visto desde Fresafit: la otra cara del
   portal. Aquí se ve TODO lo de esa cuenta —lo interno y lo compartido— con el
   nivel de visibilidad de cada cosa a la vista y cambiable de un clic.

   Es una vista, no un tablero: el kanban de /agencia/tareas sigue siendo el sitio
   para organizar el trabajo del equipo. Esto contesta otra pregunta, que es «¿en
   qué estamos con Nutravia y qué les debemos?». */
export default async function EspacioClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  await exigirModulo("agencia-clientes");
  const { slug } = await params;
  /* El rango de la bitácora viaja por la URL (compartible y sobrevive al
     refresco). Por defecto, los últimos 30 días. */
  const filtros = await searchParams;
  const hoy = hoyISO();
  const hace30 = new Date(Date.parse(`${hoy}T12:00:00Z`) - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rango = { desde: filtros.desde ?? hace30, hasta: filtros.hasta ?? hoy };
  const { supabase, user, rol: rolCrudo, perfil } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const { data: empresaData } = await supabase
    .from("agencia_empresas")
    .select("id, nombre, slug, color, giro, contacto_nombre, contacto_correo, activa")
    .eq("slug", slug)
    .maybeSingle();

  if (!empresaData) notFound();
  const empresa = empresaData as Pick<
    AgenciaEmpresa,
    "id" | "nombre" | "slug" | "color" | "giro" | "contacto_nombre" | "contacto_correo"
  > & { activa: boolean };

  const [tareas, equipo, contactosRes, comentarios, documentos, avance] = await Promise.all([
    /* Sin filtro de visibilidad: la RLS ya decide qué alcanza quien mira (lo
       privado, solo dirección o su autor). Lo que llega, se pinta con su
       etiqueta — que es justo lo que hace falta para poder compartirlo. */
    traerTodo<TaskConResponsable>((desde, hasta) =>
      supabase
        .from("tasks")
        .select(COLUMNAS_TAREA_CON_RESPONSABLE)
        .eq("espacio", "agencia")
        .eq("empresa_id", empresa.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .order("id")
        .range(desde, hasta),
    ),
    equipoCompleto(),
    /* Los contactos del cliente: quiénes entran al portal y con qué papel. */
    supabase
      .from("profiles")
      .select("id, nombre, color, rol, rol_portal, empresa_id")
      .eq("empresa_id", empresa.id)
      .order("nombre"),
    traerTodo<{ task_id: string }>((desde, hasta) =>
      supabase.from("task_comments").select("task_id").order("task_id").range(desde, hasta),
    ).catch(() => [] as { task_id: string }[]),
    /* Los archivados también: del lado del equipo, el archivo completo (el
       cliente solo ve los vivos, y eso lo corta la RLS). */
    documentosDeEmpresa(supabase, empresa.id, { incluirArchivados: true }),
    avanceDeEmpresa(supabase, empresa.id, rango),
  ]);

  const comentariosPorTarea: Record<string, number> = {};
  for (const c of comentarios) comentariosPorTarea[c.task_id] = (comentariosPorTarea[c.task_id] ?? 0) + 1;

  const contactos = (contactosRes.data ?? []) as Profile[];
  const idsDelCliente = contactos.map((c) => c.id);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/agencia/clientes"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" strokeWidth={2} />
        Clientes
      </Link>

      <EspacioCliente
        empresa={empresa}
        tareas={tareas}
        documentos={documentos}
        avance={avance}
        pendientes={pendientesPorLado(tareas, new Set(idsDelCliente))}
        rango={rango}
        equipo={equipo}
        contactos={contactos}
        idsDelCliente={idsDelCliente}
        comentariosPorTarea={comentariosPorTarea}
        currentUserId={user?.id ?? ""}
        rol={rol}
        veTodo={perfil?.rol === "direccion"}
      />
    </div>
  );
}
