import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/* Devuelve el cliente + usuario actual + su perfil, para gating server-side en
   los server actions de todos los módulos (defensa en profundidad sobre RLS).

   Envuelto en cache() de React: layout, page y actions del mismo request
   comparten UNA llamada a auth.getUser() (que es red, no cookie) y UNA query
   de perfil, en vez de repetirlas por capa. Fuera del árbol de render (route
   handlers) cache() simplemente no memoiza. */
export const usuarioActual = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { supabase, user: null, rol: null as string | null, perfil: null as Profile | null };
  }
  const { data: perfil } = await supabase
    .from("profiles")
    .select("id, nombre, rol, area, color, ve_agencia, modulos_ocultos")
    .eq("id", user.id)
    .single();
  return {
    supabase,
    user,
    rol: (perfil?.rol as string) ?? "miembro",
    perfil: (perfil as Profile | null) ?? null,
  };
});

/* ¿El rol pertenece al equipo interno? (todo menos `externo`). Espejo de
   public.es_interno() en la base de datos.
   La definición vive en lib/catalogos.ts —donde están los demás ayudantes de
   rol y de donde la leen también los componentes de cliente— y se reexporta
   aquí para no romper a quien ya la importaba de este módulo. */
export { esInterno } from "@/lib/catalogos";
