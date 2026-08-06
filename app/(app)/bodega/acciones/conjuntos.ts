"use server";

/* Acciones de conjuntos (bundles) (Bodega). Salieron del actions.ts único de 900
   líneas, que mezclaba cinco sub-dominios sin relación entre sí. El archivo
   viejo sigue existiendo como barril: re-exporta todo esto, así que ningún
   componente cambió de import. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { revalidar } from "@/app/(app)/bodega/acciones/comun";
import type {
  RolComponenteId,
} from "@/lib/types";

/* ============================ Conjuntos (bundles) ========================= */

export type ConjuntoInput = {
  sku: string;
  titulo: string;
  categoria: string | null;
  talla: string | null;
  /* La ficha del catálogo donde se acredita lo armado. Sin ella el conjunto se
     puede capturar y editar, pero no armar. */
  producto_id: string | null;
  componentes: {
    sku_componente: string;
    producto_id: string | null;
    rol: RolComponenteId | null;
    cantidad: number;
  }[];
};

export async function guardarConjunto(id: string | null, input: ConjuntoInput): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const sku = input.sku.trim().toUpperCase();
  if (!sku) return { error: "El conjunto necesita su SKU." };
  if (!input.titulo.trim()) return { error: "El conjunto necesita un título." };

  const fila = {
    sku,
    titulo: input.titulo.trim(),
    categoria: input.categoria,
    talla: input.talla,
    producto_id: input.producto_id,
  };

  const { data, error } = id
    ? await cx.supabase.from("conjuntos").update(fila).eq("id", id).select("id").single()
    : await cx.supabase.from("conjuntos").insert({ ...fila, created_by: cx.user.id }).select("id").single();

  if (error || !data) {
    if (error?.code === "23505") return { error: `Ya existe un conjunto con el SKU ${sku}.` };
    return { error: error?.message ?? "No se pudo guardar el conjunto." };
  }

  /* Los componentes se reescriben completos: son tres renglones, y diferenciar
     altas de bajas costaría más de lo que ahorra. */
  const conjuntoId = data.id as string;
  await cx.supabase.from("conjunto_componentes").delete().eq("conjunto_id", conjuntoId);
  const utiles = input.componentes.filter((c) => c.sku_componente.trim());
  if (utiles.length) {
    const { error: errorComp } = await cx.supabase.from("conjunto_componentes").insert(
      utiles.map((c) => ({
        conjunto_id: conjuntoId,
        sku_componente: c.sku_componente.trim().toUpperCase(),
        producto_id: c.producto_id,
        rol: c.rol,
        cantidad: Math.max(1, Math.trunc(c.cantidad)),
      })),
    );
    if (errorComp) return { error: errorComp.message };
  }

  revalidar();
  return { ok: true };
}

export async function borrarConjunto(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección, administración o coordinación puede borrar un conjunto.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("conjuntos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Alta en lote desde la hoja de conjuntos (una fila = conjunto + componentes). */
export async function importarConjuntos(
  filas: ConjuntoInput[],
): Promise<Resultado<{ creados: number; omitidos: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const utiles = filas.filter((f) => f.sku.trim() && f.titulo.trim());
  if (!utiles.length) return { error: "No hay conjuntos con SKU y título para importar." };

  const { data: existentes } = await cx.supabase.from("conjuntos").select("sku");
  const vistos = new Set((existentes ?? []).map((c) => String(c.sku).toUpperCase()));

  const nuevos = utiles.filter((f) => {
    const sku = f.sku.trim().toUpperCase();
    if (vistos.has(sku)) return false;
    vistos.add(sku);
    return true;
  });
  const omitidos = utiles.length - nuevos.length;
  if (!nuevos.length) return { ok: true, datos: { creados: 0, omitidos } };

  const { data, error } = await cx.supabase
    .from("conjuntos")
    .insert(
      nuevos.map((f) => ({
        sku: f.sku.trim().toUpperCase(),
        titulo: f.titulo.trim(),
        categoria: f.categoria,
        talla: f.talla,
        producto_id: f.producto_id,
        created_by: cx.user.id,
      })),
    )
    .select("id, sku");
  if (error || !data) return { error: error?.message ?? "No se pudieron crear los conjuntos." };

  const porSku = new Map(data.map((c) => [String(c.sku).toUpperCase(), c.id as string]));
  const componentes = nuevos.flatMap((f) => {
    const conjuntoId = porSku.get(f.sku.trim().toUpperCase());
    if (!conjuntoId) return [];
    return f.componentes
      .filter((c) => c.sku_componente.trim())
      .map((c) => ({
        conjunto_id: conjuntoId,
        sku_componente: c.sku_componente.trim().toUpperCase(),
        producto_id: c.producto_id,
        rol: c.rol,
        cantidad: Math.max(1, Math.trunc(c.cantidad)),
      }));
  });

  if (componentes.length) {
    const { error: errorComp } = await cx.supabase.from("conjunto_componentes").insert(componentes);
    if (errorComp) return { error: errorComp.message };
  }

  revalidar();
  return { ok: true, datos: { creados: nuevos.length, omitidos } };
}

/* ---------------------------- Ligar componentes ---------------------------
   La hoja de bodega escribía las piezas por nombre de diseño («Akatsuki»), no
   por SKU, y un nombre así resuelve a varias fichas del catálogo: el importador
   prefirió no adivinar y dejó 200 renglones sin ligar. Esto los resuelve por
   NOMBRE y no por renglón: un mismo texto aparece en decenas de conjuntos, así
   que ligarlo una vez los arregla todos.

   Se escribe SOLO `producto_id`. Reescribir además `sku_componente` al SKU real
   rompería el unique (conjunto_id, sku_componente) en cuanto dos piezas del
   mismo conjunto resolvieran a la misma ficha —y quemaría de dónde salió el
   renglón, que es lo único que queda de la hoja—. */
export type LigaComponentes = { producto_id: string; componente_ids: string[] };

export async function ligarComponentes(
  ligas: LigaComponentes[],
): Promise<Resultado<{ nombres: number; renglones: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const utiles = ligas.filter((l) => l.producto_id && l.componente_ids.length);
  if (!utiles.length) return { error: "No elegiste ninguna ficha que ligar." };

  /* Va por id de renglón y no por texto: el cliente ya tiene los componentes
     cargados y agrupó ahí, así que el servidor no tiene que replicar el criterio
     ni arriesgarse a tocar renglones que el usuario nunca vio. */
  let renglones = 0;
  for (const liga of utiles) {
    for (let i = 0; i < liga.componente_ids.length; i += 100) {
      const trozo = liga.componente_ids.slice(i, i + 100);
      const { error, count } = await cx.supabase
        .from("conjunto_componentes")
        .update({ producto_id: liga.producto_id }, { count: "exact" })
        .in("id", trozo);
      if (error) return { error: error.message };
      renglones += count ?? trozo.length;
    }
  }

  revalidar();
  return { ok: true, datos: { nombres: utiles.length, renglones } };
}

/* Ligar el conjunto a su ficha del catálogo, sin pasar por el formulario
   completo: es un solo dato y se resuelve desde la propia tabla. */
export async function ligarFichaConjunto(
  id: string,
  productoId: string | null,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("conjuntos")
    .update({ producto_id: productoId })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* ------------------------------- Armar -----------------------------------
   El asiento doble —bajan las piezas, sube la ficha del conjunto— vive entero
   en la RPC: plpgsql es una transacción, así que o se mueve todo o no se mueve
   nada. Aquí solo se traduce el resultado.

   No se llama a propagarStock: con el candado de solo lectura puesto es un
   no-op, y lo que sí hace falta —acordarse de capturarlo a mano en los
   canales— lo lleva `conjunto_armados.subido_en`. */
export async function armarConjunto(
  conjuntoId: string,
  cantidad: number,
  nota?: string,
): Promise<Resultado<{ armadoId: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    return { error: "Di cuántos conjuntos armaste (tiene que ser un número entero mayor que cero)." };
  }

  const { data, error } = await cx.supabase.rpc("armar_conjunto", {
    cid: conjuntoId,
    n: cantidad,
    /* Se omite si viene vacía: `p_nota` es `default null` en la función y su
       cuerpo hace coalesce, así que omitirla y mandar null es lo mismo. */
    p_nota: textoONulo(nota ?? "") ?? undefined,
  });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true, datos: { armadoId: String(data) } };
}

export async function desarmarConjunto(armadoId: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.rpc("desarmar_conjunto", { aid: armadoId });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* El CRM no escribe stock en Tienda Nube, Mercado Libre ni TikTok, así que lo
   armado se captura a mano allá. Esto salda esa cuenta. */
export async function marcarConjuntoSubido(
  conjuntoId: string,
): Promise<Resultado<{ marcados: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase.rpc("marcar_conjunto_subido", { cid: conjuntoId });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true, datos: { marcados: Number(data ?? 0) } };
}
