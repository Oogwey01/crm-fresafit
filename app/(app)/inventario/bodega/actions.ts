"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
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
const RUTAS = ["/inventario/bodega", "/inventario"];

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

  const { error } = await cx.supabase.from("recepcion_items").insert(
    utiles.map((f) => ({
      recepcion_id: recepcionId,
      sku: f.sku.trim(),
      producto_id: f.producto_id,
      unidades_no_procesadas: Math.max(0, Math.trunc(f.unidades_no_procesadas)),
      sku_consolidado: f.sku_consolidado,
      categoria: f.categoria,
      producto_nombre: f.producto_nombre,
      talla: f.talla,
    })),
  );

  if (error) return { error: error.message };
  revalidar();
  return { ok: true, datos: { creados: utiles.length } };
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

/* ============================ Envíos full ================================= */

export type EnvioFullInput = {
  destino: DestinoFullId;
  nombre: string;
  estado: EstadoEnvioFullId;
  fecha_envio: string | null;
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

export async function guardarCajaFull(
  id: string,
  dimensiones: string,
  pesoKg: number | null,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  const { error } = await cx.supabase
    .from("envio_full_cajas")
    .update({ dimensiones: textoONulo(dimensiones), peso_kg: pesoKg })
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

  const { error: errBorrar } = await cx.supabase
    .from("insumo_presentaciones")
    .delete()
    .eq("insumo_id", insumoId);
  if (errBorrar) return { error: errBorrar.message };

  if (validas.length) {
    const { error: errIns } = await cx.supabase.from("insumo_presentaciones").insert(validas);
    if (errIns) return { error: errIns.message };
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
     pegando de nuevo la hoja. */
  const { data: existentes } = await cx.supabase.from("insumos").select("id, nombre");
  const yaEsta = new Set(
    ((existentes ?? []) as { nombre: string }[]).map((i) => i.nombre.trim().toLowerCase()),
  );

  /* Agrupa por nombre respetando el orden en que venían pegadas. */
  const grupos = new Map<string, FilaRecursoInput[]>();
  for (const f of filas) {
    const nombre = f.nombre.trim();
    if (!nombre) continue;
    const clave = nombre.toLowerCase();
    grupos.set(clave, [...(grupos.get(clave) ?? []), { ...f, nombre }]);
  }

  let creados = 0;
  let presentaciones = 0;
  let omitidos = 0;

  for (const [clave, grupo] of grupos) {
    if (yaEsta.has(clave)) {
      omitidos++;
      continue;
    }
    const base = grupo[0];
    /* El stock, el mínimo y el máximo van en celdas combinadas de la hoja: se
       toma el primer valor que traiga alguna de las filas del grupo. */
    const primerTexto = (campo: "empresa" | "dimensiones" | "link") =>
      grupo.map((g) => g[campo]?.trim()).find(Boolean) ?? "";
    const primerNumero = (campo: "stock" | "minimo" | "maximo") =>
      grupo.map((g) => g[campo]).find((v) => v != null) ?? null;

    /* Nace en cero y la existencia entra como movimiento: así el histórico
       explica de dónde salió cada pieza desde el primer día. */
    const stock = Number(primerNumero("stock") ?? 0);
    const maximo = primerNumero("maximo");
    const { data: insumo, error } = await cx.supabase
      .from("insumos")
      .insert({
        nombre: base.nombre,
        categoria,
        empresa: textoONulo(primerTexto("empresa")),
        dimensiones: textoONulo(primerTexto("dimensiones")),
        unidad: base.unidad.trim() || "pieza",
        stock: 0,
        minimo: Number(primerNumero("minimo") ?? 0),
        maximo: maximo != null ? Number(maximo) : null,
        reserva: grupo.reduce((a, g) => a + (g.reserva || 0), 0),
        pedido: grupo.reduce((a, g) => a + (g.pedido || 0), 0),
        link: textoONulo(primerTexto("link")),
        created_by: cx.user.id,
      })
      .select("id")
      .single();

    if (error || !insumo) return { error: error?.message ?? "No se pudo crear el insumo." };
    creados++;

    const conPrecio = grupo.filter((g) => g.unidades > 0);
    if (conPrecio.length) {
      const { error: errPres } = await cx.supabase.from("insumo_presentaciones").insert(
        conPrecio.map((g) => ({
          insumo_id: insumo.id as string,
          descripcion: g.unidades > 1 ? `Paquete de ${g.unidades}` : "Pieza",
          unidades: g.unidades,
          precio: g.precio,
          reserva: g.reserva || 0,
          pedido: g.pedido || 0,
          link: textoONulo(g.link),
        })),
      );
      if (errPres) return { error: errPres.message };
      presentaciones += conPrecio.length;
    }

    if (stock > 0) {
      await cx.supabase.rpc("mover_insumo", {
        iid: insumo.id as string,
        p_tipo: "entrada",
        p_cantidad: stock,
        p_motivo: "Carga inicial desde la hoja de recursos",
      });
    }
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
