import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/* El `sub` (id del usuario) del payload de un JWT, SIN validar la firma: es
   solo el dato tentativo con el que se adelanta la query del perfil. Ante
   cualquier cosa rara devuelve null y se sigue por el camino lento. */
function subDelToken(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/* Devuelve el cliente + usuario actual + su perfil, para gating server-side en
   los server actions de todos los módulos (defensa en profundidad sobre RLS).

   Envuelto en cache() de React: layout, page y actions del mismo request
   comparten UNA llamada a auth.getUser() (que es red, no cookie) y UNA query
   de perfil, en vez de repetirlas por capa. Fuera del árbol de render (route
   handlers) cache() simplemente no memoiza. */
export const usuarioActual = cache(async () => {
  const supabase = await createClient();

  /* getUser() (red) y la query del perfil iban encadenadas: dos viajes en
     serie que pagaba cada navegación. El id para el perfil se toma de la
     cookie (getSession no valida, solo lee) y ambas salen EN PARALELO. Es
     seguro: la query viaja con el token real y RLS manda, y el resultado solo
     se usa si getUser() confirma ese mismo id; si no coincide —cookie
     manipulada o sesión cambiada a media request— se repite con el id bueno.

     El `sub` se decodifica del token A MANO y no leyendo `session.user`:
     supabase-js envuelve esa propiedad en un Proxy que suelta el aviso
     «could be insecure!» en CADA acceso, y aquí inundaba el log del server
     con cada navegación. El uso es el mismo (dato tentativo, confirmado
     después); solo cambia la puerta por la que se lee. */
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const idTentativo = subDelToken(session?.access_token);

  const consultaPerfil = (id: string) =>
    supabase
      .from("profiles")
      /* `empresa_id` y `rol_portal` viajan aquí porque el portal los necesita en
         CADA pantalla (para saber de qué empresa es quien mira y si puede pedir
         cosas), y este perfil ya está cacheado por request: pedirlos aparte
         sería una segunda consulta por navegación. En el equipo de casa van
         null y no pesan. */
      .select("id, nombre, rol, area, color, ve_agencia, modulos_ocultos, empresa_id, rol_portal")
      .eq("id", id)
      .single();

  const [userRes, perfilTentativo] = await Promise.all([
    supabase.auth.getUser(),
    idTentativo ? consultaPerfil(idTentativo) : Promise.resolve(null),
  ]);
  const user = userRes.data.user;
  if (!user) {
    return { supabase, user: null, rol: null as string | null, perfil: null as Profile | null };
  }

  const { data: perfil } =
    perfilTentativo && idTentativo === user.id ? perfilTentativo : await consultaPerfil(user.id);

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
