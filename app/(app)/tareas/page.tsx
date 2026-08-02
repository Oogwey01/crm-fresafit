import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { Board } from "@/components/tareas/board";
import type { TaskConResponsable, Profile, RolId } from "@/lib/types";

export const metadata = { title: "Tareas · Fresafit" };

export default async function TareasPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, user, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [tareasRes, borradasRes, equipoRes, checklistRes] = await Promise.all([
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
  ]);

  const tareas = (tareasRes.data ?? []) as unknown as TaskConResponsable[];
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
