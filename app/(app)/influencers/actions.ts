"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { obtenerTierInfluencer } from "@/lib/catalogos";
import type { EtapaInfluencerId, TierInfluencerId } from "@/lib/types";

/* Todo el módulo es de gestores: maneja crédito en producto y comisiones. La BD
   lo refuerza con RLS (policies es_gestor) — esto es defensa en profundidad. */
const NO_AUTORIZADO = "Solo dirección, administración o coordinación puede ver el programa de influencers.";

/* El programa no tiene ruta propia: vive como pestaña de «Clientes y ventas».
   Esta carpeta conserva solo las acciones (sin page.tsx no hay ruta). */
const RUTA = "/clientes";

export type InfluencerInput = {
  nombre: string;
  correo: string;
  celular: string;
  ig_usuario: string;
  ig_seguidores: number | null;
  tiktok_usuario: string;
  tiktok_seguidores: number | null;
  tipo_contenido: string;
  etapa: EtapaInfluencerId;
  tier: TierInfluencerId | null;
  codigo: string;
  descuento_pct: number | null;
  comision_pct: number | null;
  credito_mensual: number | null;
  inicio_prueba: string | null;
  notas: string;
};

/* ============================ Ficha ======================================= */

export async function guardarInfluencer(
  id: string | null,
  input: InfluencerInput,
): Promise<Resultado> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "La ficha necesita un nombre." };

  const fila = {
    nombre,
    correo: textoONulo(input.correo),
    celular: textoONulo(input.celular),
    ig_usuario: textoONulo(input.ig_usuario),
    ig_seguidores: input.ig_seguidores,
    tiktok_usuario: textoONulo(input.tiktok_usuario),
    tiktok_seguidores: input.tiktok_seguidores,
    tipo_contenido: textoONulo(input.tipo_contenido),
    etapa: input.etapa,
    tier: input.tier,
    codigo: textoONulo(input.codigo)?.toUpperCase() ?? null,
    descuento_pct: input.descuento_pct,
    comision_pct: input.comision_pct,
    credito_mensual: input.credito_mensual,
    inicio_prueba: input.inicio_prueba,
    notas: textoONulo(input.notas),
  };

  const { error } = id
    ? await cx.supabase.from("influencers").update(fila).eq("id", id)
    : await cx.supabase.from("influencers").insert({ ...fila, created_by: cx.user.id });

  if (error) return { error: mensajeDeCodigo(error) };
  revalidatePath(RUTA);
  return { ok: true };
}

/* Mover de etapa desde la tabla, sin abrir la ficha. Al activar a alguien con
   tier se copian los valores del tier que sigan vacíos: es lo que se le ofreció
   y tenerlos escritos evita adivinar meses después si se negoció otra cosa. */
export async function cambiarEtapaInfluencer(
  id: string,
  etapa: EtapaInfluencerId,
): Promise<Resultado> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const { data: actual, error: errorLectura } = await cx.supabase
    .from("influencers")
    .select("tier, descuento_pct, comision_pct, credito_mensual, inicio_prueba")
    .eq("id", id)
    .single();
  if (errorLectura) return { error: errorLectura.message };

  const cambio: Record<string, unknown> = { etapa };
  const tier = obtenerTierInfluencer(actual?.tier);
  if (etapa === "activo" && tier) {
    if (actual?.descuento_pct == null) cambio.descuento_pct = tier.descuentoPct;
    if (actual?.comision_pct == null) cambio.comision_pct = tier.comisionPct;
    if (actual?.credito_mensual == null && tier.creditoMensual != null)
      cambio.credito_mensual = tier.creditoMensual;
    /* El periodo de prueba arranca cuando entra, no cuando se capturó. */
    if (!actual?.inicio_prueba) cambio.inicio_prueba = new Date().toISOString().slice(0, 10);
  }

  const { error } = await cx.supabase.from("influencers").update(cambio).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(RUTA);
  return { ok: true };
}

export async function borrarInfluencer(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;
  /* Entregas y evaluaciones se van en cascada (definido en la migración). */
  const { error } = await cx.supabase.from("influencers").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(RUTA);
  return { ok: true };
}

/* ============================ Entregas de material ======================== */

export type EntregaInput = {
  influencer_id: string;
  fecha: string;
  producto_id: string | null;
  descripcion: string;
  talla: string;
  cantidad: number;
  valor: number | null;
  notas: string;
};

export async function guardarEntrega(id: string | null, input: EntregaInput): Promise<Resultado> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  if (!input.influencer_id) return { error: "Falta a quién se le entregó." };
  if (!input.producto_id && !input.descripcion.trim())
    return { error: "Elige un producto o describe qué se entregó." };
  if (!Number.isFinite(input.cantidad) || input.cantidad <= 0)
    return { error: "La cantidad tiene que ser mayor a cero." };

  const fila = {
    influencer_id: input.influencer_id,
    fecha: input.fecha,
    producto_id: input.producto_id,
    descripcion: textoONulo(input.descripcion),
    talla: textoONulo(input.talla),
    cantidad: Math.trunc(input.cantidad),
    valor: input.valor,
    notas: textoONulo(input.notas),
  };

  const { error } = id
    ? await cx.supabase.from("influencer_entregas").update(fila).eq("id", id)
    : await cx.supabase.from("influencer_entregas").insert({ ...fila, created_by: cx.user.id });

  if (error) return { error: error.message };
  revalidatePath(RUTA);
  return { ok: true };
}

export async function borrarEntrega(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("influencer_entregas").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(RUTA);
  return { ok: true };
}

/* ============================ Evaluación mensual ========================== */

export type EvaluacionInput = {
  influencer_id: string;
  /* Cualquier día del mes evaluado; se normaliza al día 1. */
  periodo: string;
  usos_codigo: number | null;
  ventas_monto: number | null;
  videos: number | null;
  stories: number | null;
  participaciones: number | null;
  contenido_organico: boolean;
  observaciones: string;
};

export async function guardarEvaluacion(input: EvaluacionInput): Promise<Resultado> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  if (!input.influencer_id) return { error: "Falta de quién es la evaluación." };
  if (!input.periodo) return { error: "Falta el mes que se evalúa." };
  const periodo = `${input.periodo.slice(0, 7)}-01`;

  /* Upsert por (persona, mes): volver a evaluar el mismo mes corrige la fila en
     vez de duplicarla, que es lo que pasaba en la hoja de cálculo. */
  const { error } = await cx.supabase.from("influencer_evaluaciones").upsert(
    {
      influencer_id: input.influencer_id,
      periodo,
      usos_codigo: input.usos_codigo,
      ventas_monto: input.ventas_monto,
      videos: input.videos,
      stories: input.stories,
      participaciones: input.participaciones,
      contenido_organico: input.contenido_organico,
      observaciones: textoONulo(input.observaciones),
      created_by: cx.user.id,
    },
    { onConflict: "influencer_id,periodo" },
  );

  if (error) return { error: error.message };
  revalidatePath(RUTA);
  return { ok: true };
}

export async function borrarEvaluacion(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("influencer_evaluaciones").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(RUTA);
  return { ok: true };
}

/* ============================ Importar prospectos ========================= */

export type ProspectoInput = {
  nombre: string;
  correo: string | null;
  celular: string | null;
  ig_usuario: string | null;
  ig_seguidores: number | null;
  tiktok_usuario: string | null;
  tiktok_seguidores: number | null;
  tipo_contenido: string | null;
};

/* Alta en lote desde las respuestas del formulario de convocatoria. El
   formulario tiene respuestas repetidas (la gente lo llenó dos veces), así que
   se descarta lo que ya existe por correo o por handle de Instagram y se
   reporta cuántas se omitieron en vez de fallar. */
export async function importarProspectos(
  filas: ProspectoInput[],
): Promise<Resultado<{ creados: number; omitidos: number }>> {
  const cx = await exigirRol("gestor", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const conNombre = filas.filter((f) => f.nombre.trim());
  if (!conNombre.length) return { error: "No hay renglones con nombre para importar." };

  const { data: existentes, error: errorLectura } = await cx.supabase
    .from("influencers")
    .select("correo, ig_usuario");
  if (errorLectura) return { error: errorLectura.message };

  const vistos = new Set<string>();
  for (const e of existentes ?? []) {
    if (e.correo) vistos.add(`c:${String(e.correo).toLowerCase()}`);
    if (e.ig_usuario) vistos.add(`i:${String(e.ig_usuario).toLowerCase()}`);
  }

  const nuevas: ProspectoInput[] = [];
  for (const f of conNombre) {
    const claves = [
      f.correo ? `c:${f.correo.toLowerCase()}` : null,
      f.ig_usuario ? `i:${f.ig_usuario.toLowerCase()}` : null,
    ].filter(Boolean) as string[];
    if (claves.some((k) => vistos.has(k))) continue;
    claves.forEach((k) => vistos.add(k));
    nuevas.push(f);
  }

  const omitidos = conNombre.length - nuevas.length;
  if (!nuevas.length) return { ok: true, datos: { creados: 0, omitidos } };

  const { error } = await cx.supabase.from("influencers").insert(
    nuevas.map((f) => ({
      nombre: f.nombre.trim(),
      correo: f.correo,
      celular: f.celular,
      ig_usuario: f.ig_usuario,
      ig_seguidores: f.ig_seguidores,
      tiktok_usuario: f.tiktok_usuario,
      tiktok_seguidores: f.tiktok_seguidores,
      tipo_contenido: f.tipo_contenido,
      etapa: "prospecto" as const,
      created_by: cx.user.id,
    })),
  );

  if (error) return { error: error.message };
  revalidatePath(RUTA);
  return { ok: true, datos: { creados: nuevas.length, omitidos } };
}

/* El código duplicado es el único choque de índice que el usuario puede causar
   escribiendo: vale la pena decirle qué pasó en vez del mensaje de Postgres. */
function mensajeDeCodigo(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Ese código ya está asignado a otro influencer.";
  return error.message;
}
