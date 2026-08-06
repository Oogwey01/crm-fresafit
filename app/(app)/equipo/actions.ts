"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { AREAS, MODULO_PORTADA, ROLES, obtenerModulo } from "@/lib/catalogos";
import type { AreaId, RolId } from "@/lib/types";

/* Cambiar el acceso de alguien cambia lo que ve en TODO el CRM, así que se
   revalida el layout entero: el menú se pinta con el perfil, y si solo se
   refrescara /equipo la barra lateral seguiría mostrando lo de antes. */
function revalidarTodo() {
  revalidatePath("/", "layout");
}

/* Solo dirección toca esta pantalla: es la que reparte el acceso de los demás.
   La BD aplica lo mismo por su cuenta —la policy "perfiles: actualizar propio o
   admin" y el trigger `proteger_columnas_profiles`, que congela rol, área y
   `ve_agencia` para quien no es dirección—, así que esto es defensa en
   profundidad y, sobre todo, el mensaje con palabras. */
const SOLO_DIRECCION = "Solo Dirección puede cambiar los accesos del equipo.";

export async function cambiarRol(userId: string, rol: RolId): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  if (!ROLES.some((r) => r.id === rol)) return { error: "Ese rol no existe." };

  /* Nadie se cambia el rol a sí mismo. No es paternalismo: dirección es el
     único rol que puede repartir accesos, así que quitárselo por error es un
     candado sin llave —habría que arreglarlo con SQL a mano— y de paso
     garantiza que el equipo nunca se queda sin dirección. */
  if (userId === cx.user.id) {
    return { error: "No puedes cambiar tu propio rol. Pídeselo a la otra persona de Dirección." };
  }

  const { error } = await cx.supabase.from("profiles").update({ rol }).eq("id", userId);
  if (error) return { error: error.message };
  revalidarTodo();
  return { ok: true };
}

export async function cambiarArea(userId: string, area: AreaId | null): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;
  if (area && !AREAS.some((a) => a.id === area)) return { error: "Esa área no existe." };

  const { error } = await cx.supabase.from("profiles").update({ area }).eq("id", userId);
  if (error) return { error: error.message };
  /* El área de una persona decide el área de las tareas que se le asignan, así
     que los tableros también cambian de agrupación. */
  revalidarTodo();
  return { ok: true };
}

/* Abrir o cerrar UNA sección para alguien.

   Es una lista negra —se guardan las que NO ve— y por eso solo puede restar:
   marcar una sección que su rol no le daba no se la da, porque el candado de
   verdad es la RLS. Para subirle el techo se le cambia el rol.

   La portada (Tareas de Fresafit) no se puede cerrar: es a donde va a parar
   quien entra a una sección que no le toca, así que cerrarla sería un rebote
   infinito. */
export async function cambiarAccesoModulo(
  userId: string,
  moduloId: string,
  puedeVer: boolean,
): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;

  const modulo = obtenerModulo(moduloId);
  if (!modulo) return { error: "Esa sección no existe." };
  if (moduloId === MODULO_PORTADA && !puedeVer) {
    return { error: "Las tareas de Fresafit son la portada del CRM: no se pueden cerrar." };
  }

  const { data, error: errLeer } = await cx.supabase
    .from("profiles")
    .select("modulos_ocultos")
    .eq("id", userId)
    .single();
  if (errLeer) return { error: errLeer.message };

  /* Se recalcula sobre lo que hay en la base y no sobre lo que traía la
     pantalla: dos personas de dirección repartiendo accesos a la vez no se
     pisan la lista entera por haber leído el mismo estado viejo. */
  const actuales: string[] = data?.modulos_ocultos ?? [];
  const ocultos = puedeVer
    ? actuales.filter((id) => id !== moduloId)
    : [...new Set([...actuales, moduloId])];

  const { error } = await cx.supabase
    .from("profiles")
    .update({ modulos_ocultos: ocultos })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidarTodo();
  return { ok: true };
}

/* Dar o quitar el acceso al espacio Agencia (el selector de negocio y todo
   /agencia). Es por persona a propósito: quienes la llevan no forman un rol. */
export async function cambiarAccesoAgencia(userId: string, puede: boolean): Promise<Resultado> {
  const cx = await exigirRol("direccion", SOLO_DIRECCION);
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("profiles")
    .update({ ve_agencia: puede })
    .eq("id", userId);
  if (error) return { error: error.message };
  revalidarTodo();
  return { ok: true };
}
