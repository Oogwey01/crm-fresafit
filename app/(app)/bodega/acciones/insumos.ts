"use server";

/* Acciones de insumos (Bodega). Salieron del actions.ts único de 900
   líneas, que mezclaba cinco sub-dominios sin relación entre sí. El archivo
   viejo sigue existiendo como barril: re-exporta todo esto, así que ningún
   componente cambió de import. */

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { TAM_LOTE_UPSERT } from "@/lib/supabase/lotes";
import { traerTodo } from "@/lib/canales/paginacion";
import { textoONulo } from "@/lib/validacion";
import { revalidar } from "@/app/(app)/bodega/acciones/comun";
import type {
  CategoriaInsumoId,
} from "@/lib/types";

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
