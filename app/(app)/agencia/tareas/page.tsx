import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { equipoCompleto } from "@/lib/supabase/consultas";
import { traerTodo } from "@/lib/canales/paginacion";
import { COLUMNAS_TAREA_CON_RESPONSABLE, LIMITE_PAPELERA } from "@/lib/tareas/consulta";
import { Board } from "@/components/tareas/board";
import type { AgenciaEmpresa, TaskConResponsable, Profile, RolId } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Tareas · Agencia Fresafit" };

/* Una persona acompañando una tarea, con el perfil ya resuelto por el embed. */
type FilaAsignado = { task_id: string; perfil: Pick<Profile, "id" | "nombre" | "color"> | null };

/* Tablero de la Agencia: el mismo de Fresafit, con las tareas del otro negocio y
   agrupadas por CLIENTE en vez de por área.

   No lleva candado de rol como el resto de /agencia (empresas, cobros, nómina):
   estas tareas las trabaja quien atiende a cada cuenta, no quien cobra. Lo que
   sigue cerrado es cuánto paga cada cliente, no qué hay que hacerle. */
export default async function TareasAgenciaPage() {
  await exigirModulo("agencia-tareas");
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, user, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  /* Las tres tablas satélite del final van paginadas por el mismo motivo que en
     /tareas: se piden sin filtro (son de TODAS las tareas, de los dos espacios)
     y PostgREST corta en 1000 filas sin avisar. Con una tanda basta mientras no
     se llegue a ese número, así que no cuesta consultas de más. */
  const [tareasCrudas, borradasRes, equipo, empresasRes, checklist, lecturas, asignados] =
    await Promise.all([
      /* Paginadas igual que en /tareas: las abiertas crecen con el uso y el
         techo de PostgREST quitaría las tarjetas más viejas sin avisar. */
      traerTodo<TaskConResponsable>((desde, hasta) =>
        supabase
          .from("tasks")
          .select(COLUMNAS_TAREA_CON_RESPONSABLE)
          .eq("espacio", "agencia")
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .order("id")
          .range(desde, hasta) as unknown as PromiseLike<{
          data: TaskConResponsable[] | null;
          error: { message: string } | null;
        }>,
      ),
      /* Papelera acotada a las 100 más recientes, igual que en /tareas: se
         entra a recuperar algo que se borró hace poco, no a arqueología. */
      supabase
        .from("tasks")
        .select(COLUMNAS_TAREA_CON_RESPONSABLE)
        .eq("espacio", "agencia")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(LIMITE_PAPELERA),
      equipoCompleto(),
      /* Los clientes activos. Va como consulta aparte y NO como embed de `tasks`
         a propósito: son dos o tres filas que se reusan en cada tarjeta, y de
         paso el tablero sigue cargando aunque la RLS de agencia_empresas cambie.
         El equipo interno puede leer el nombre; los contratos siguen cerrados. */
      supabase
        .from("agencia_empresas")
        .select("id, nombre, color, activa")
        .order("nombre"),
      traerTodo<{ task_id: string; hecho: boolean }>((desde, hasta) =>
        supabase.from("task_checklist").select("task_id, hecho").order("id").range(desde, hasta),
      ),
      /* Igual que en /tareas: las tablas de lecturas y coasignados se aplican a
         mano, así que su ausencia degrada la vista (sin puntos de novedad, sin
         avatares extra) en vez de tumbar el tablero. */
      traerTodo<{ task_id: string; leido_at: string }>((desde, hasta) =>
        supabase.from("task_reads").select("task_id, leido_at").order("task_id").range(desde, hasta),
      ).catch((e: unknown) => {
        console.warn("[agencia/tareas] task_reads no disponible:", e instanceof Error ? e.message : e);
        return [];
      }),
      traerTodo<FilaAsignado>((desde, hasta) =>
        supabase
          .from("task_assignees")
          .select("task_id, perfil:profiles!user_id(id, nombre, color)")
          .order("task_id")
          .order("user_id")
          .range(desde, hasta) as unknown as PromiseLike<{
          data: FilaAsignado[] | null;
          error: { message: string } | null;
        }>,
      ).catch((e: unknown) => {
        console.warn(
          "[agencia/tareas] task_assignees no disponible:",
          e instanceof Error ? e.message : e,
        );
        return [] as FilaAsignado[];
      }),
    ]);

  if (empresasRes.error) {
    console.warn("[agencia/tareas] agencia_empresas no disponible:", empresasRes.error.message);
  }

  const leidoPorTarea = new Map(lecturas.map((l) => [l.task_id, l.leido_at]));

  const coasignadosPorTarea = new Map<string, Pick<Profile, "id" | "nombre" | "color">[]>();
  for (const a of asignados) {
    if (!a.perfil) continue;
    const lista = coasignadosPorTarea.get(a.task_id) ?? [];
    lista.push(a.perfil);
    coasignadosPorTarea.set(a.task_id, lista);
  }

  type EmpresaChip = Pick<AgenciaEmpresa, "id" | "nombre" | "color">;
  const empresasTodas = (empresasRes.data ?? []) as (EmpresaChip & { activa: boolean })[];
  /* En el selector solo van las cuentas vivas —dar de alta trabajo para un
     cliente que ya se fue es un error de dedo—, pero el chip de la tarjeta tiene
     que resolver también a los inactivos: sus tareas viejas siguen ahí. */
  const empresas: EmpresaChip[] = empresasTodas
    .filter((e) => e.activa)
    .map(({ id, nombre, color }) => ({ id, nombre, color }));
  const porId = new Map(empresasTodas.map((e) => [e.id, e]));

  const conEquipo = (t: TaskConResponsable): TaskConResponsable => ({
    ...t,
    leido_at: leidoPorTarea.get(t.id) ?? null,
    coasignados: coasignadosPorTarea.get(t.id) ?? [],
    empresa: t.empresa_id ? (porId.get(t.empresa_id) ?? null) : null,
  });

  const tareas = tareasCrudas.map(conEquipo);
  const borradas = ((borradasRes.data ?? []) as unknown as TaskConResponsable[]).map(conEquipo);

  const checklistPorTarea: Record<string, { total: number; hechos: number }> = {};
  for (const c of checklist) {
    const r = (checklistPorTarea[c.task_id] ??= { total: 0, hechos: 0 });
    r.total += 1;
    if (c.hecho) r.hechos += 1;
  }

  return (
    <Board
      tareas={tareas}
      borradas={borradas}
      equipo={equipo}
      currentUserId={user?.id ?? ""}
      rol={rol}
      checklistPorTarea={checklistPorTarea}
      espacio="agencia"
      empresas={empresas}
    />
  );
}
