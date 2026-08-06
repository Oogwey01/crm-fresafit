"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";
import { traerTodo } from "@/lib/canales/paginacion";
import { textoONulo } from "@/lib/validacion";
import type {
  CategoriaInsumoId,
  DestinoFullId,
  EstadoEnvioFullId,
  EstadoRecepcionId,
  RolComponenteId,
} from "@/lib/types";

/* Bodega la opera todo el equipo interno (los de piso son rol miembro); borrar
   queda en gestores. El stock de insumos tiene su propia jerarquía, en la RPC
   mover_insumo(). La BD lo refuerza con RLS. */
/* Bodega y el catálogo se revalidan juntos: descontar una carga o mover un
   insumo cambia el stock que pinta /inventario. */
const RUTAS = ["/bodega", "/inventario"];

function revalidar() {
  for (const r of RUTAS) revalidatePath(r);
}

/* ============================ Recepción de mercancía ====================== */

export type RecepcionInput = {
  titulo: string;
  canal: "tienda_nube" | "mercado_libre";
  pedido_proveedor_id: string | null;
  notas: string;
};

export async function guardarRecepcion(
  id: string | null,
  input: RecepcionInput,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const titulo = input.titulo.trim();
  if (!titulo) return { error: "Ponle nombre a la carga (p. ej. «Carga 04/08 playeras»)." };

  const fila = {
    titulo,
    canal: input.canal,
    pedido_proveedor_id: input.pedido_proveedor_id,
    notas: textoONulo(input.notas),
  };

  const { data, error } = id
    ? await cx.supabase.from("recepciones_bodega").update(fila).eq("id", id).select("id").single()
    : await cx.supabase
        .from("recepciones_bodega")
        .insert({ ...fila, created_by: cx.user.id })
        .select("id")
        .single();

  if (error || !data) return { error: error?.message ?? "No se pudo guardar la carga." };
  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export async function cerrarRecepcion(id: string, cerrar: boolean): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("recepciones_bodega")
    .update({ estado: cerrar ? "cerrada" : "abierta", cerrada_en: cerrar ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarRecepcion(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección, administración o coordinación puede borrar una carga.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("recepciones_bodega").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export type RecepcionItemInput = {
  sku: string;
  producto_id: string | null;
  unidades_no_procesadas: number;
  sku_consolidado: string | null;
  categoria: string | null;
  producto_nombre: string | null;
  talla: string | null;
};

/* La fila tal como la guarda la tabla. La comparten el pegado en bloque y el
   alta de uno en uno para que un renglón capturado a mano quede idéntico a uno
   pegado: mismo recorte, mismo SKU en mayúsculas, mismas unidades enteras. */
function filaRecepcion(recepcionId: string, f: RecepcionItemInput) {
  return {
    recepcion_id: recepcionId,
    sku: f.sku.trim().toUpperCase(),
    producto_id: f.producto_id,
    unidades_no_procesadas: Math.max(0, Math.trunc(f.unidades_no_procesadas)),
    sku_consolidado: textoONulo(f.sku_consolidado ?? ""),
    categoria: textoONulo(f.categoria ?? ""),
    producto_nombre: textoONulo(f.producto_nombre ?? ""),
    talla: textoONulo(f.talla ?? ""),
  };
}

/* Alta en lote de los renglones pegados desde la plantilla de la hoja. */
export async function importarItemsRecepcion(
  recepcionId: string,
  filas: RecepcionItemInput[],
): Promise<Resultado<{ creados: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!recepcionId) return { error: "Falta la carga a la que pertenecen los renglones." };

  const utiles = filas.filter((f) => f.sku.trim());
  if (!utiles.length) return { error: "No hay renglones con SKU para importar." };

  const { error } = await cx.supabase
    .from("recepcion_items")
    .insert(utiles.map((f) => filaRecepcion(recepcionId, f)));

  if (error) return { error: error.message };
  revalidar();
  return { ok: true, datos: { creados: utiles.length } };
}

/* Un renglón capturado a mano. Existe además del pegado porque la hoja no
   siempre alcanza: llega un SKU que no venía en la plantilla, o hay que
   registrar lo que trajo el proveedor de más. Nace en «traer», como los
   pegados: el estado lo mueve el piso. */
export async function agregarItemRecepcion(
  recepcionId: string,
  input: RecepcionItemInput,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!recepcionId) return { error: "Falta la carga a la que pertenece el renglón." };
  if (!input.sku.trim()) return { error: "El renglón necesita su SKU." };
  if (!Number.isFinite(input.unidades_no_procesadas) || input.unidades_no_procesadas <= 0)
    return { error: "Las unidades tienen que ser más de cero." };

  const { error } = await cx.supabase
    .from("recepcion_items")
    .insert(filaRecepcion(recepcionId, input));
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Mover un renglón por los estados de la hoja. «descontado» no se escribe a
   mano: pasa por la RPC, que suma el stock y deja rastro una sola vez. */
export async function cambiarEstadoItem(
  id: string,
  estado: EstadoRecepcionId,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  if (estado === "descontado") {
    const { error } = await cx.supabase.rpc("descontar_recepcion", { iid: id });
    if (error) return { error: error.message };
    revalidar();
    return { ok: true };
  }

  const { error } = await cx.supabase.from("recepcion_items").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Descontar de golpe lo que ya está checado: es el paso final de una carga y
   hacerlo renglón por renglón con 200 SKUs no es viable en el piso. El recorrido
   vive en la base (descontar_recepcion_lote), así que es UN viaje a Supabase en
   vez de uno por renglón, y además todo o nada: si un renglón truena, no queda
   media carga sumada al stock. */
export async function descontarChecados(
  recepcionId: string,
): Promise<Resultado<{ descontados: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase.rpc("descontar_recepcion_lote", {
    rid: recepcionId,
  });
  if (error) return { error: error.message };

  revalidar();
  return { ok: true, datos: { descontados: Number(data ?? 0) } };
}

export async function borrarItemRecepcion(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("recepcion_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

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
    p_nota: textoONulo(nota ?? ""),
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

/* ============================ Envíos full ================================= */

export type EnvioFullInput = {
  destino: DestinoFullId;
  nombre: string;
  estado: EstadoEnvioFullId;
  fecha_envio: string | null;
  /* La guía: todo captura manual, tal como venía en la hoja. */
  id_plataforma: string;
  paqueteria: string;
  tipo_envio: string;
  num_guia: string;
  fecha_llegada_estimada: string | null;
  notas: string;
};

export async function guardarEnvioFull(
  id: string | null,
  input: EnvioFullInput,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!input.nombre.trim()) return { error: "Ponle nombre al envío." };

  const fila = {
    destino: input.destino,
    nombre: input.nombre.trim(),
    estado: input.estado,
    fecha_envio: input.fecha_envio,
    id_plataforma: textoONulo(input.id_plataforma),
    paqueteria: textoONulo(input.paqueteria),
    tipo_envio: textoONulo(input.tipo_envio),
    num_guia: textoONulo(input.num_guia),
    fecha_llegada_estimada: input.fecha_llegada_estimada,
    notas: textoONulo(input.notas),
  };

  const { data, error } = id
    ? await cx.supabase.from("envios_full").update(fila).eq("id", id).select("id").single()
    : await cx.supabase.from("envios_full").insert({ ...fila, created_by: cx.user.id }).select("id").single();

  if (error || !data) return { error: error?.message ?? "No se pudo guardar el envío." };
  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export async function borrarEnvioFull(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección, administración o coordinación puede borrar un envío.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("envios_full").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function agregarCajaFull(envioId: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { data } = await cx.supabase
    .from("envio_full_cajas")
    .select("numero")
    .eq("envio_id", envioId)
    .order("numero", { ascending: false })
    .limit(1);
  const siguiente = ((data?.[0]?.numero as number) ?? 0) + 1;

  const { error } = await cx.supabase
    .from("envio_full_cajas")
    .insert({ envio_id: envioId, numero: siguiente });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Las medidas de la caja, cada una por su lado y en centímetros. Null = todavía
   no se mide; el cero es un valor válido (nadie lo va a capturar, pero si lo
   hace no hay razón para convertirlo en "sin dato"). */
export type MedidasCajaInput = {
  largo_cm: number | null;
  ancho_cm: number | null;
  alto_cm: number | null;
  peso_kg: number | null;
};

export async function guardarCajaFull(
  id: string,
  medidas: MedidasCajaInput,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  /* La BD las declara numeric(6,2) con check >= 0: se atajan aquí para que un
     dedazo devuelva una frase y no el error crudo de Postgres. */
  const valores = [medidas.largo_cm, medidas.ancho_cm, medidas.alto_cm, medidas.peso_kg];
  if (valores.some((v) => v !== null && (!Number.isFinite(v) || v < 0)))
    return { error: "Las medidas y el peso no pueden ir en negativo." };
  if (valores.some((v) => v !== null && v > 9999.99))
    return { error: "Revisa la medida: no cabe en el campo (máximo 9999.99)." };

  const { error } = await cx.supabase
    .from("envio_full_cajas")
    .update({
      largo_cm: medidas.largo_cm,
      ancho_cm: medidas.ancho_cm,
      alto_cm: medidas.alto_cm,
      peso_kg: medidas.peso_kg,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarCajaFull(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("envio_full_cajas").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export type ItemFullInput = {
  caja_id: string;
  producto_id: string | null;
  sku: string;
  asin: string;
  cantidad: number;
};

export async function agregarItemFull(input: ItemFullInput): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!input.sku.trim()) return { error: "El renglón necesita su SKU." };
  if (!Number.isFinite(input.cantidad) || input.cantidad <= 0)
    return { error: "La cantidad tiene que ser mayor a cero." };

  const { error } = await cx.supabase.from("envio_full_items").insert({
    caja_id: input.caja_id,
    producto_id: input.producto_id,
    sku: input.sku.trim().toUpperCase(),
    asin: textoONulo(input.asin),
    cantidad: Math.trunc(input.cantidad),
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* El checklist «PASOS PARA UN FULL PERFECTO» de la hoja. */
export async function marcarChecklistFull(
  id: string,
  campo: "empaquetado" | "cancelado" | "descontado",
  valor: boolean,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("envio_full_items")
    .update({ [campo]: valor })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function borrarItemFull(id: string): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("envio_full_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* ============================ Insumos ===================================== */

export type PresentacionInput = {
  descripcion: string;
  unidades: number;
  precio: number | null;
  reserva: number;
  pedido: number;
  link: string;
};

export type InsumoInput = {
  nombre: string;
  unidad: string;
  minimo: number;
  notas: string;
  activo: boolean;
  categoria: CategoriaInsumoId | null;
  empresa: string;
  dimensiones: string;
  maximo: number | null;
  link: string;
  /* Cómo se compra: cada medida con su precio. Se reescriben en bloque, como
     los componentes de un conjunto: son pocas y editarlas una a una desde el
     diálogo pedía un id por renglón que a nadie le importa. */
  presentaciones: PresentacionInput[];
};

/* Dar de alta y editar el catálogo de insumos es administrativo; moverlos es
   otra cosa (ver moverInsumo). */
export async function guardarInsumo(id: string | null, input: InsumoInput): Promise<Resultado> {
  const cx = await exigirRol("admin", "Solo dirección o administración puede dar de alta insumos.");
  if ("error" in cx) return cx;

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "El insumo necesita un nombre." };

  const fila = {
    nombre,
    unidad: input.unidad.trim() || "pieza",
    minimo: Math.max(0, input.minimo),
    notas: textoONulo(input.notas),
    activo: input.activo,
    categoria: input.categoria,
    empresa: textoONulo(input.empresa),
    dimensiones: textoONulo(input.dimensiones),
    maximo: input.maximo != null && input.maximo >= 0 ? input.maximo : null,
    link: textoONulo(input.link),
  };

  const { data, error } = id
    ? await cx.supabase.from("insumos").update(fila).eq("id", id).select("id").single()
    : await cx.supabase
        .from("insumos")
        .insert({ ...fila, created_by: cx.user.id })
        .select("id")
        .single();

  if (error || !data) return { error: error?.message ?? "No se pudo guardar." };
  const insumoId = data.id as string;

  /* Las presentaciones cargadas desde la hoja traen `clave` (su llave natural).
     Reescribirlas las perdería, así que solo se borran las que no la tienen y
     las de la hoja se dejan intactas salvo que se editen aquí. */
  const validas = input.presentaciones
    .filter((p) => Number.isFinite(p.unidades) && p.unidades > 0)
    .map((p) => ({
      insumo_id: insumoId,
      descripcion: textoONulo(p.descripcion),
      unidades: Math.round(p.unidades),
      precio: p.precio != null && p.precio >= 0 ? p.precio : null,
      reserva: Math.max(0, p.reserva || 0),
      pedido: Math.max(0, p.pedido || 0),
      link: textoONulo(p.link),
    }));

  /* Se insertan las nuevas ANTES de podar las viejas: al revés, un fallo entre
     las dos sentencias dejaba el insumo sin ninguna presentación —y con ella se
     va el precio de compra—. Así lo peor es que se dupliquen, que se ve. */
  const { data: previas, error: errPrevias } = await cx.supabase
    .from("insumo_presentaciones")
    .select("id")
    .eq("insumo_id", insumoId);
  if (errPrevias) return { error: errPrevias.message };

  if (validas.length) {
    const { error: errIns } = await cx.supabase.from("insumo_presentaciones").insert(validas);
    if (errIns) return { error: errIns.message };
  }

  const viejas = (previas ?? []).map((p) => p.id as string);
  if (viejas.length) {
    const { error: errBorrar } = await cx.supabase
      .from("insumo_presentaciones")
      .delete()
      .in("id", viejas);
    if (errBorrar) return { error: errBorrar.message };
  }

  revalidar();
  return { ok: true };
}

/* Pegar el bloque de una sección de la hoja «Recursos FRESA FIT».
   Cada fila es una presentación; las filas con el mismo nombre se agrupan en un
   solo insumo, que es justo como está la hoja (celdas combinadas para las
   etiquetas que se compran en cuatro medidas). */
export type FilaRecursoInput = {
  nombre: string;
  empresa: string;
  dimensiones: string;
  unidad: string;
  unidades: number;
  precio: number | null;
  reserva: number;
  pedido: number;
  stock: number | null;
  minimo: number | null;
  maximo: number | null;
  link: string;
};

export async function importarInsumos(
  categoria: CategoriaInsumoId,
  filas: FilaRecursoInput[],
): Promise<Resultado<{ creados: number; presentaciones: number; omitidos: number }>> {
  const cx = await exigirRol("admin", "Solo dirección o administración puede dar de alta insumos.");
  if ("error" in cx) return cx;
  if (!filas.length) return { error: "No hay nada que importar." };

  /* Lo que ya existe no se toca: la existencia se mueve con un movimiento, no
     pegando de nuevo la hoja. Paginado, porque un select a secas se corta en
     ~1000 y un nombre fuera de la lista se daría de alta repetido. */
  const existentes = await traerTodo<{ nombre: string }>((desde, hasta) =>
    cx.supabase.from("insumos").select("nombre").order("id").range(desde, hasta),
  );
  const yaEsta = new Set(existentes.map((i) => i.nombre.trim().toLowerCase()));

  /* Agrupa por nombre respetando el orden en que venían pegadas. */
  const grupos = new Map<string, FilaRecursoInput[]>();
  for (const f of filas) {
    const nombre = f.nombre.trim();
    if (!nombre) continue;
    const clave = nombre.toLowerCase();
    grupos.set(clave, [...(grupos.get(clave) ?? []), { ...f, nombre }]);
  }

  /* Antes esto eran hasta TRES viajes por insumo —su insert, el de sus
     presentaciones y la RPC del stock inicial— uno tras otro: una hoja de 200
     renglones costaba ~600 round-trips en serie. Ahora son dos inserts en lote
     y las RPC del stock en tandas paralelas. */
  const nuevos = [...grupos.entries()].filter(([clave]) => !yaEsta.has(clave));
  const omitidos = grupos.size - nuevos.length;
  if (!nuevos.length) {
    revalidar();
    return { ok: true, datos: { creados: 0, presentaciones: 0, omitidos } };
  }

  /* El stock, el mínimo y el máximo van en celdas combinadas de la hoja: se
     toma el primer valor que traiga alguna de las filas del grupo. */
  const primerTexto = (grupo: FilaRecursoInput[], campo: "empresa" | "dimensiones" | "link") =>
    grupo.map((g) => g[campo]?.trim()).find(Boolean) ?? "";
  const primerNumero = (grupo: FilaRecursoInput[], campo: "stock" | "minimo" | "maximo") =>
    grupo.map((g) => g[campo]).find((v) => v != null) ?? null;

  /* Nacen en cero y la existencia entra como movimiento: así el histórico
     explica de dónde salió cada pieza desde el primer día. */
  const filasInsumo = nuevos.map(([, grupo]) => {
    const maximo = primerNumero(grupo, "maximo");
    return {
      nombre: grupo[0].nombre,
      categoria,
      empresa: textoONulo(primerTexto(grupo, "empresa")),
      dimensiones: textoONulo(primerTexto(grupo, "dimensiones")),
      unidad: grupo[0].unidad.trim() || "pieza",
      stock: 0,
      minimo: Number(primerNumero(grupo, "minimo") ?? 0),
      maximo: maximo != null ? Number(maximo) : null,
      reserva: grupo.reduce((a, g) => a + (g.reserva || 0), 0),
      pedido: grupo.reduce((a, g) => a + (g.pedido || 0), 0),
      link: textoONulo(primerTexto(grupo, "link")),
      created_by: cx.user.id,
    };
  });

  const idPorClave = new Map<string, string>();
  for (let i = 0; i < filasInsumo.length; i += TAM_LOTE_UPSERT) {
    const { data, error } = await cx.supabase
      .from("insumos")
      .insert(filasInsumo.slice(i, i + TAM_LOTE_UPSERT))
      .select("id, nombre");
    if (error || !data) return { error: error?.message ?? "No se pudieron crear los insumos." };
    for (const f of data) idPorClave.set((f.nombre as string).trim().toLowerCase(), f.id as string);
  }
  const creados = idPorClave.size;

  const filasPresentacion = nuevos.flatMap(([clave, grupo]) => {
    const insumoId = idPorClave.get(clave);
    if (!insumoId) return [];
    return grupo
      .filter((g) => g.unidades > 0)
      .map((g) => ({
        insumo_id: insumoId,
        descripcion: g.unidades > 1 ? `Paquete de ${g.unidades}` : "Pieza",
        unidades: g.unidades,
        precio: g.precio,
        reserva: g.reserva || 0,
        pedido: g.pedido || 0,
        link: textoONulo(g.link),
      }));
  });
  for (let i = 0; i < filasPresentacion.length; i += TAM_LOTE_UPSERT) {
    const { error: errPres } = await cx.supabase
      .from("insumo_presentaciones")
      .insert(filasPresentacion.slice(i, i + TAM_LOTE_UPSERT));
    if (errPres) return { error: errPres.message };
  }
  const presentaciones = filasPresentacion.length;

  /* mover_insumo va uno por insumo (la RPC valida permiso y arma el histórico),
     pero en tandas paralelas. Igual que antes, un fallo aquí no tira la
     importación: el insumo ya existe y el stock se puede mover a mano. */
  const conStock = nuevos
    .map(([clave, grupo]) => ({
      id: idPorClave.get(clave),
      stock: Number(primerNumero(grupo, "stock") ?? 0),
    }))
    .filter((x): x is { id: string; stock: number } => !!x.id && x.stock > 0);
  const RPC_POR_TANDA = 8;
  for (let i = 0; i < conStock.length; i += RPC_POR_TANDA) {
    await Promise.all(
      conStock.slice(i, i + RPC_POR_TANDA).map((x) =>
        cx.supabase.rpc("mover_insumo", {
          iid: x.id,
          p_tipo: "entrada",
          p_cantidad: x.stock,
          p_motivo: "Carga inicial desde la hoja de recursos",
        }),
      ),
    );
  }

  revalidar();
  return { ok: true, datos: { creados, presentaciones, omitidos } };
}

export async function borrarInsumo(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", "Solo dirección o administración puede borrar insumos.");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase.from("insumos").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Entrada, salida o ajuste. El permiso lo valida la RPC (security definer): un
   miembro sin permiso recibe el error de la BD aunque llame directo. */
export async function moverInsumo(
  insumoId: string,
  tipo: "entrada" | "salida" | "ajuste",
  cantidad: number,
  motivo: string,
): Promise<Resultado<{ stock: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  if (!Number.isFinite(cantidad) || cantidad < 0)
    return { error: "La cantidad no puede ser negativa." };

  const { data, error } = await cx.supabase.rpc("mover_insumo", {
    iid: insumoId,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_motivo: motivo,
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true, datos: { stock: Number(data) } };
}

/* Habilitar o quitarle a alguien el permiso de descontar insumos. Es la
   jerarquía que pidió René: él descuenta, Germán observa. */
export async function cambiarPermisoInsumos(
  profileId: string,
  puedeDescontar: boolean,
): Promise<Resultado> {
  const cx = await exigirRol("admin", "Solo dirección o administración puede dar este permiso.");
  if ("error" in cx) return cx;

  if (!puedeDescontar) {
    const { error } = await cx.supabase.from("insumo_permisos").delete().eq("profile_id", profileId);
    if (error) return { error: error.message };
  } else {
    const { error } = await cx.supabase
      .from("insumo_permisos")
      .upsert(
        { profile_id: profileId, puede_descontar: true, otorgado_por: cx.user.id },
        { onConflict: "profile_id" },
      );
    if (error) return { error: error.message };
  }

  revalidar();
  return { ok: true };
}
