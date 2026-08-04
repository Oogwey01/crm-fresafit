import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { Board } from "@/components/tareas/board";
import type { TaskConResponsable, Profile, RolId } from "@/lib/types";

export const metadata = { title: "Tareas · Fresafit" };

export default async function TareasPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, user, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [tareasRes, borradasRes, equipoRes, checklistRes, lecturasRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, responsable:profiles!responsable_id(id, nombre, color)")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    // Papelera (RLS sigue limitando qué borradas ve cada quien).
    supabase
      .from("tasks")
      .select("*, responsable:profiles!responsable_id(id, nombre, color)")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
    // Resumen de subtareas por tarea (para el chip de progreso en las tarjetas).
    supabase.from("task_checklist").select("task_id, hecho"),
    /* Cuándo vi cada tarea por última vez (RLS ya las acota a las mías): es lo
       que permite marcar cuáles traen algo nuevo PARA MÍ. */
    supabase.from("task_reads").select("task_id, leido_at"),
  ]);

  /* La marca de lectura se pega a cada tarea para que las vistas solo tengan que
     comparar dos fechas. `task_reads` es de una migración reciente que se aplica
     a mano: sin ella, `tieneNovedades` devuelve false y el tablero funciona
     igual, solo que sin puntos de "hay algo nuevo". */
  if (lecturasRes.error) {
    console.warn("[tareas] task_reads no disponible:", lecturasRes.error.message);
  }
  const leidoPorTarea = new Map(
    ((lecturasRes.data ?? []) as { task_id: string; leido_at: string }[]).map((l) => [
      l.task_id,
      l.leido_at,
    ]),
  );
  const conLectura = (t: TaskConResponsable): TaskConResponsable => ({
    ...t,
    leido_at: leidoPorTarea.get(t.id) ?? null,
  });

  const tareas = ((tareasRes.data ?? []) as unknown as TaskConResponsable[]).map(conLectura);
  const borradas = (borradasRes.data ?? []) as unknown as TaskConResponsable[];
  const equipo = (equipoRes.data ?? []) as Profile[];

  /* {task_id: {total, hechos}} — el resumen que alimenta el chip de subtareas. */
  const checklistPorTarea: Record<string, { total: number; hechos: number }> = {};
  for (const c of (checklistRes.data ?? []) as { task_id: string; hecho: boolean }[]) {
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
