import { createClient } from "@/lib/supabase/server";

/* Devuelve el cliente + usuario actual + su rol, para gating server-side en
   los server actions de todos los módulos (defensa en profundidad sobre RLS). */
export async function usuarioActual() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, rol: null as string | null };
  const { data: perfil } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", user.id)
    .single();
  return { supabase, user, rol: (perfil?.rol as string) ?? "miembro" };
}

/* ¿El rol pertenece al equipo interno? (todo menos `externo`). Espejo de
   public.es_interno() en la base de datos. */
export function esInterno(rol: string | null | undefined) {
  return rol === "direccion" || rol === "coordinador" || rol === "miembro";
}
