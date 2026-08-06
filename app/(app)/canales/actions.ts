"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import type { CanalId } from "@/lib/types";

/* Quién ve los números de cada plataforma.

   Cada canal tiene su encargado, y para llevarlo necesita sus cifras —cuánto
   vendió, qué se llevó de comisión, cuánto depositó— sin ver por eso las del
   negocio entero. Este es ese permiso suelto, con la misma forma que el de
   descontar insumos en Bodega: la FILA es el permiso, así que otorgarlo es
   insertar y quitarlo es borrar.

   Solo DIRECCIÓN, y no es celo: si administración pudiera, se lo daría a sí
   misma en los tres canales y el cierre de ingresos quedaría en nada. Es el
   mismo motivo por el que solo dirección cambia los roles del equipo. La RLS lo
   refuerza con `ve_ingresos()`; esto es la defensa en profundidad de siempre. */
export async function cambiarPermisoDineroCanal(
  profileId: string,
  canal: CanalId,
  puede: boolean,
): Promise<Resultado> {
  const cx = await exigirRol(
    "direccion",
    "Solo Dirección decide quién ve los números de un canal.",
  );
  if ("error" in cx) return cx;

  const { error } = puede
    ? await cx.supabase
        .from("dinero_permisos_canal")
        .upsert(
          { profile_id: profileId, canal, otorgado_por: cx.user.id },
          { onConflict: "profile_id,canal" },
        )
    : await cx.supabase
        .from("dinero_permisos_canal")
        .delete()
        .eq("profile_id", profileId)
        .eq("canal", canal);

  if (error) return { error: error.message };

  /* Las cuatro pantallas que cambian de contenido con esto: las tres del canal
     y Métricas, que también respeta el permiso al filtrar por plataforma. */
  ["/canales/mercadolibre", "/canales/tiendanube", "/canales/tiktok", "/metricas"].forEach((r) =>
    revalidatePath(r),
  );
  return { ok: true };
}
