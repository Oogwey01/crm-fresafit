import { createClient } from "@/lib/supabase/server";
import { Board } from "@/components/tareas/board";
import type { TaskConResponsable, Profile, RolId } from "@/lib/types";

export const metadata = { title: "Tareas · Fresafit" };

export default async function TareasPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [tareasRes, equipoRes, perfilRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, responsable:profiles!responsable_id(id, nombre, color)")
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
    user
      ? supabase.from("profiles").select("rol").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const tareas = (tareasRes.data ?? []) as unknown as TaskConResponsable[];
  const equipo = (equipoRes.data ?? []) as Profile[];
  const rol = ((perfilRes.data as { rol?: RolId } | null)?.rol ?? "miembro") as RolId;

  return (
    <Board
      tareas={tareas}
      equipo={equipo}
      currentUserId={user?.id ?? ""}
      rol={rol}
    />
  );
}
