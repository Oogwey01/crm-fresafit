import { cache } from "react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { SIN_DINERO, vistaDineroDeRol, type VistaDinero } from "@/lib/permisos-dinero";
import type { CanalId } from "@/lib/types";

/* Resuelve de una vez lo que esta persona puede ver de dinero: lo que le da el
   rol más los permisos sueltos por canal (el encargado de una plataforma ve las
   cifras de la suya sin ver las del negocio).

   Envuelto en cache() de React por lo mismo que `usuarioActual`: la vista la
   preguntan la página, sus componentes y las actions del mismo request, y sin
   esto serían tres viajes a `dinero_permisos_canal` para responder lo mismo.

   Quien ya ve los ingresos completos no necesita la consulta: los permisos por
   canal solo suman, nunca restan, así que para dirección se ahorra el viaje. */
export const vistaDinero = cache(async (): Promise<VistaDinero> => {
  const { supabase, user, rol } = await usuarioActual();
  if (!user) return SIN_DINERO;

  const base = vistaDineroDeRol(rol);
  if (base.ingresos) return { ...base, canales: [] };

  const { data, error } = await supabase
    .from("dinero_permisos_canal")
    .select("canal")
    .eq("profile_id", user.id);

  /* Si la consulta falla —lo más probable, que la migración aún no se haya
     pegado— se sigue con lo que da el rol. Un error aquí no puede acabar
     enseñando de más. */
  if (error) {
    console.warn("[dinero] permisos por canal no disponibles:", error.message);
    return { ...base, canales: [] };
  }

  return { ...base, canales: (data ?? []).map((f) => f.canal as CanalId) };
});
