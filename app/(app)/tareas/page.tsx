import { createClient } from "@/lib/supabase/server";
import { Board } from "@/components/tareas/board";
import type { TaskConResponsable, Profile, RolId } from "@/lib/types";

export const metadata = { title: "Tareas · Fresafit" };

export default async function TareasPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [tareasRes, borradasRes, equipoRes, perfilRes] = await Promise.all([
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
    user
      ? supabase.from("profiles").select("rol").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const tareas = (tareasRes.data ?? []) as unknown as TaskConResponsable[];
  const borradas = (borradasRes.data ?? []) as unknown as TaskConResponsable[];
  const equipo = (equipoRes.data ?? []) as Profile[];
  const rol = ((perfilRes.data as { rol?: RolId } | null)?.rol ?? "miembro") as RolId;

  return (
    <Board
      tareas={tareas}
      borradas={borradas}
      equipo={equipo}
      currentUserId={user?.id ?? ""}
      rol={rol}
    />
  );
}
