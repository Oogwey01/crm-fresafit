import type { User } from "@supabase/supabase-js";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { esGestor, puedeAdministrar } from "@/lib/catalogos";

type Sesion = Awaited<ReturnType<typeof usuarioActual>>;

/* El retorno va anotado explícito: sin la anotación, TS infiere la unión con
   `error?: undefined` en la rama de éxito y el narrowing `"error" in cx` de
   los callers deja de discriminar. */
export type ContextoRol =
  | { supabase: Sesion["supabase"]; user: User; rol: string }
  | { error: string };

/* Portero único de los server actions: autentica y exige un nivel de rol,
   devolviendo el contexto listo o el error listo para retornar. Generaliza el
   patrón `direccion()` de finanzas. La BD refuerza lo mismo con RLS — esto es
   defensa en profundidad, y el mensaje se personaliza por action porque es el
   texto que ve el usuario en el toast. */
/* `admin` = quien lleva la administración (dirección + administración): gastos,
   nómina, reportes y agencia. `direccion` sigue siendo el nivel de arriba, para
   lo que decide quién es quién: roles del equipo y ventas importadas por API. */
export type NivelRol = "autenticado" | "interno" | "gestor" | "admin" | "direccion";

const MENSAJE_POR_NIVEL: Record<NivelRol, string> = {
  autenticado: "No autenticado.",
  interno: "Solo el equipo interno puede hacer esto.",
  gestor: "Solo dirección, administración o coordinación puede hacer esto.",
  admin: "Solo dirección o administración puede hacer esto.",
  direccion: "Solo Dirección puede hacer esto.",
};

export async function exigirRol(nivel: NivelRol, mensaje?: string): Promise<ContextoRol> {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return { error: "No autenticado." };
  const pasa =
    nivel === "autenticado" ||
    (nivel === "interno" && esInterno(rol)) ||
    (nivel === "gestor" && esGestor(rol)) ||
    (nivel === "admin" && puedeAdministrar(rol)) ||
    (nivel === "direccion" && rol === "direccion");
  if (!pasa) return { error: mensaje ?? MENSAJE_POR_NIVEL[nivel] };
  return { supabase, user, rol: rol ?? "miembro" };
}
