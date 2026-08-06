import { createAdminClient } from "@/lib/supabase/admin";
import type { Canal } from "@/lib/canales/tipos";
import type { Json } from "@/lib/supabase/tipos-bd";

/* Acceso compartido a la tabla `integraciones` (una fila por canal). Antes
   cada canal tenía copiado el select de `datos`, el merge-update y el estado
   para la UI. */

/* Alias del tipo compartido: los ids de `integraciones` son los slugs. */
export type CanalIntegracion = Canal;

/* El blob `datos` de la fila del canal ({} si no existe la fila). */
export async function leerDatosIntegracion(id: CanalIntegracion): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const { data } = await admin.from("integraciones").select("datos").eq("id", id).maybeSingle();
  return (data?.datos ?? {}) as Record<string, unknown>;
}

/* Mezcla `parche` sobre `datos` y lo guarda. Si el caller ya leyó el blob en
   este mismo flujo, lo pasa como `base` y se ahorra la relectura (mismas dos
   queries que el patrón copiado que sustituye). */
export async function mezclarDatosIntegracion(
  id: CanalIntegracion,
  parche: Record<string, unknown>,
  base?: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const datos = base ?? (await leerDatosIntegracion(id));
  await admin
    .from("integraciones")
    .update({ datos: { ...datos, ...parche } as Json })
    .eq("id", id);
}

export type EstadoIntegracion = { conectada: boolean; ultimaSync: string | null };

const NO_CONECTADA: EstadoIntegracion = { conectada: false, ultimaSync: null };

/* Estado para la UI (sin exponer tokens) de los tres canales en UNA query.
   Si el entorno no tiene service role, todo se reporta como no conectado
   (misma semántica que tenían los tres `estado*` copiados). */
export async function estadoCanales(): Promise<Record<CanalIntegracion, EstadoIntegracion>> {
  const resultado: Record<CanalIntegracion, EstadoIntegracion> = {
    tiendanube: { ...NO_CONECTADA },
    mercadolibre: { ...NO_CONECTADA },
    tiktok: { ...NO_CONECTADA },
  };
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("integraciones")
      .select("id, datos")
      .in("id", ["tiendanube", "mercadolibre", "tiktok"]);
    for (const fila of data ?? []) {
      const datos = fila.datos as { ultima_sync?: string } | null;
      resultado[fila.id as CanalIntegracion] = {
        conectada: true,
        ultimaSync: datos?.ultima_sync ?? null,
      };
    }
  } catch {
    /* Sin service role o sin red: todo queda como no conectado. */
  }
  return resultado;
}

/* Estado de un solo canal (cuerpo único de los antiguos estadoTiendanube /
   estadoMercadolibre / estadoTiktok, byte-idénticos salvo el literal). */
export async function estadoIntegracion(id: CanalIntegracion): Promise<EstadoIntegracion> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("integraciones").select("datos").eq("id", id).maybeSingle();
    if (!data) return { ...NO_CONECTADA };
    const datos = data.datos as { ultima_sync?: string } | null;
    return { conectada: true, ultimaSync: datos?.ultima_sync ?? null };
  } catch {
    return { ...NO_CONECTADA };
  }
}
