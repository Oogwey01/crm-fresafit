import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { Board } from "@/components/tareas/board";
import type { TaskConResponsable, Profile, RolId } from "@/lib/types";

export const metadata = { title: "Tareas · Fresafit" };

/* Una persona acompañando una tarea, con el perfil ya resuelto por el embed. */
type FilaAsignado = { task_id: string; perfil: Pick<Profile, "id" | "nombre" | "color"> | null };

export default async function TareasPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, user, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  /* Las tres tablas satélite se piden SIN filtro (son de todas las tareas, no
     solo las del tablero) y por eso son las primeras en toparse con el techo de
     PostgREST: corta en 1000 filas sin avisar, y con varias subtareas y varios
     lectores por tarea ese número se alcanza mucho antes que las tareas mismas.
     El síntoma sería mudo y desconcertante: chips de subtareas en cero y puntos
     de "hay algo nuevo" que no se apagan, solo en las tareas más viejas. Van
     paginadas con traerTodo, que mientras quepan en una tanda sigue costando
     una sola consulta. */
  const [tareasRes, borradasRes, equipoRes, checklist, lecturas, asignados] =
    await Promise.all([
      /* Solo las de Fresafit: las de la agencia tienen su propio tablero en
         /agencia/tareas y mezclarlas obligaba a filtrar de cabeza. */
      supabase
        .from("tasks")
        .select("*, responsable:profiles!responsable_id(id, nombre, color)")
        .eq("espacio", "fresafit")
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      /* Papelera (RLS sigue limitando qué borradas ve cada quien). Acotada a
         las 100 más recientes: viajaba COMPLETA en cada carga del tablero y
         crece para siempre, aunque casi nadie la abre — se entra a ella a
         recuperar algo que se borró hace poco, no a arqueología. */
      supabase
        .from("tasks")
        .select("*, responsable:profiles!responsable_id(id, nombre, color)")
        .eq("espacio", "fresafit")
        .not("deleted_at", "is", null)
        .order("deleted_at", { ascending: false })
        .limit(100),
      supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
      // Resumen de subtareas por tarea (para el chip de progreso en las tarjetas).
      traerTodo<{ task_id: string; hecho: boolean }>((desde, hasta) =>
        supabase.from("task_checklist").select("task_id, hecho").order("id").range(desde, hasta),
      ),
      /* Cuándo vi cada tarea por última vez (RLS ya las acota a las mías): es lo
         que permite marcar cuáles traen algo nuevo PARA MÍ.
         `task_reads` es de una migración que se aplica a mano: si faltara, el
         tablero se pinta sin los puntos de "hay algo nuevo" en vez de caerse. */
      traerTodo<{ task_id: string; leido_at: string }>((desde, hasta) =>
        supabase.from("task_reads").select("task_id, leido_at").order("task_id").range(desde, hasta),
      ).catch((e: unknown) => {
        console.warn("[tareas] task_reads no disponible:", e instanceof Error ? e.message : e);
        return [];
      }),
      /* Las demás personas de cada tarea. Va aparte y no como embed del select
         de `tasks` a propósito: si la migración de coasignados todavía no se
         aplicó, un embed rompería la carga entera del tablero; así solo se
         pierden los avatares extra. */
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
        console.warn("[tareas] task_assignees no disponible:", e instanceof Error ? e.message : e);
        return [] as FilaAsignado[];
      }),
    ]);

  /* La marca de lectura se pega a cada tarea para que las vistas solo tengan que
     comparar dos fechas. */
  const leidoPorTarea = new Map(lecturas.map((l) => [l.task_id, l.leido_at]));
  const coasignadosPorTarea = new Map<string, Pick<Profile, "id" | "nombre" | "color">[]>();
  for (const a of asignados) {
    if (!a.perfil) continue;
    const lista = coasignadosPorTarea.get(a.task_id) ?? [];
    lista.push(a.perfil);
    coasignadosPorTarea.set(a.task_id, lista);
  }

  const conEquipo = (t: TaskConResponsable): TaskConResponsable => ({
    ...t,
    leido_at: leidoPorTarea.get(t.id) ?? null,
    coasignados: coasignadosPorTarea.get(t.id) ?? [],
  });

  const tareas = ((tareasRes.data ?? []) as unknown as TaskConResponsable[]).map(conEquipo);
  const borradas = ((borradasRes.data ?? []) as unknown as TaskConResponsable[]).map(conEquipo);
  const equipo = (equipoRes.data ?? []) as Profile[];

  /* {task_id: {total, hechos}} — el resumen que alimenta el chip de subtareas. */
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
    />
  );
}
