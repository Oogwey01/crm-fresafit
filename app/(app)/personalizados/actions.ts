"use server";

import { revalidatePath } from "next/cache";
import type { TablesInsert, TablesUpdate } from "@/lib/supabase/tipos-bd";
import { mensajeDeError, type Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { archivoDeFormData, rutaParaArchivo, urlFirmada } from "@/lib/storage";
import {
  propagarArteDePersonalizado,
  type ResumenEnlaceArte,
} from "@/lib/maquila/enlace-personalizados";
import { sembrarPersonalizadosDeMaquila } from "@/lib/personalizados/desde-maquila";
import type {
  EstadoPersonalizadoId,
  ModeloPersonalizadoId,
  TipoPersonalizadoId,
} from "@/lib/types";

/* Los cinturones personalizados los capturan y los mueven los diseñadores, que
   son rol miembro: por eso todo es exigirRol("interno") y solo borrar sube a
   gestor. La RLS de `personalizados` lo refuerza. */
function revalidar() {
  revalidatePath("/personalizados");
}

export type PersonalizadoInput = {
  cliente: string;
  tipo: TipoPersonalizadoId | null;
  modelo: ModeloPersonalizadoId | null;
  talla: string;
  no_venta: string;
  /* La orden del CRM a la que quedó ligado, si se eligió de la lista. Convive
     con `no_venta`, que sigue siendo texto libre: ver buscarVentas. */
  sale_order_id: string | null;
  canal: "tienda_nube" | "mercado_libre" | "tiktok_shop" | "otro" | null;
  fecha_compra: string | null;
  fecha_produccion: string | null;
  fecha_limite: string | null;
  url: string;
  estado: EstadoPersonalizadoId;
  notas: string;
  responsable_id: string | null;
};

export async function guardarPersonalizado(
  id: string | null,
  input: PersonalizadoInput,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const cliente = input.cliente.trim();
  if (!cliente) return { error: "Falta de quién es el personalizado." };

  const fila = {
    cliente,
    tipo: input.tipo,
    modelo: input.modelo,
    talla: textoONulo(input.talla),
    no_venta: textoONulo(input.no_venta),
    sale_order_id: input.sale_order_id,
    canal: input.canal,
    fecha_compra: input.fecha_compra,
    fecha_produccion: input.fecha_produccion,
    fecha_limite: input.fecha_limite,
    url: textoONulo(input.url),
    estado: input.estado,
    notas: textoONulo(input.notas),
    responsable_id: input.responsable_id,
  };

  const { data, error } = id
    ? await cx.supabase.from("personalizados").update(fila).eq("id", id).select("id").single()
    : await cx.supabase
        .from("personalizados")
        .insert({ ...fila, created_by: cx.user.id })
        .select("id")
        .single();

  if (error || !data) return { error: error?.message ?? "No se pudo guardar." };

  /* El diálogo también puede dejar la ficha en «En producción» de una sentada:
     mismo efecto que moverla con el selector del tablero. */
  if (input.estado === "produccion") {
    await soltarAMaquila(cx.supabase, data.id as string, cx.user.id);
  }

  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export async function cambiarEstadoPersonalizado(
  id: string,
  estado: EstadoPersonalizadoId,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  /* Al mandarlo a producción se estampa la fecha si nadie la puso: ese día es
     justo el dato que la hoja nunca tenía. */
  const cambio: TablesUpdate<"personalizados"> = { estado };
  if (estado === "produccion") {
    const { data } = await cx.supabase
      .from("personalizados")
      .select("fecha_produccion")
      .eq("id", id)
      .single();
    if (!data?.fecha_produccion) cambio.fecha_produccion = new Date().toISOString().slice(0, 10);
  }

  const { error } = await cx.supabase.from("personalizados").update(cambio).eq("id", id);
  if (error) return { error: error.message };

  if (estado === "produccion") await soltarAMaquila(cx.supabase, id, cx.user.id);

  revalidar();
  return { ok: true };
}

/* «En producción» es el momento en que el pedido deja de ser de diseño y pasa a
   ser de Eduardo: hasta entonces su tablero no lo enseña (components/maquila/
   tablero.tsx). Es exactamente lo que ya hacía subir el arte, así que va por la
   misma función — liga el pedido si hace falta, marca el arte entregado y
   recalcula la promesa desde hoy.

   No lanza ni bloquea el cambio de estado: la ficha ya se guardó, y si la liga
   no se pudo hacer (dos pedidos candidatos en la misma orden) se resuelve desde
   el detalle del pedido en /maquila. */
async function soltarAMaquila(
  supabase: Parameters<typeof propagarArteDePersonalizado>[0],
  id: string,
  usuarioId: string,
): Promise<void> {
  try {
    const arte = await propagarArteDePersonalizado(supabase, id, usuarioId);
    if (arte.ligados || arte.marcados) revalidatePath("/maquila");
  } catch (e) {
    console.error(
      "[personalizados] soltar a maquila:",
      mensajeDeError(e, "no se pudo avisarle al tablero de maquila"),
    );
  }
}

export async function borrarPersonalizado(id: string, fotoPath: string | null): Promise<Resultado> {
  const cx = await exigirRol(
    "gestor",
    "Solo dirección, administración o coordinación puede borrar un personalizado.",
  );
  if ("error" in cx) return cx;
  if (fotoPath) await cx.supabase.storage.from("personalizados").remove([fotoPath]);
  const { error } = await cx.supabase.from("personalizados").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* La foto del diseño aprobado (la sube quien diseña). Se guarda la ruta en la
   ficha; el binario vive en el bucket privado `personalizados`. */
export async function subirFotoPersonalizado(
  id: string,
  formData: FormData,
): Promise<Resultado<{ path: string; arte: ResumenEnlaceArte }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const archivo = archivoDeFormData(formData, {
    soloImagenes: true,
    maxMB: 10,
    mensajeExcedido: "La imagen supera 10 MB.",
  });
  if ("error" in archivo) return archivo;

  const path = rutaParaArchivo(id, archivo.file.name);
  const { error: errorSubida } = await cx.supabase.storage
    .from("personalizados")
    .upload(path, archivo.file, { contentType: archivo.file.type || undefined, upsert: false });
  if (errorSubida) return { error: errorSubida.message };

  /* Si la ficha no acepta la ruta, se limpia el binario para no dejar basura. */
  const { data: anterior } = await cx.supabase
    .from("personalizados")
    .select("foto_path")
    .eq("id", id)
    .single();
  const { error } = await cx.supabase.from("personalizados").update({ foto_path: path }).eq("id", id);
  if (error) {
    await cx.supabase.storage.from("personalizados").remove([path]);
    return { error: error.message };
  }
  if (anterior?.foto_path) {
    await cx.supabase.storage.from("personalizados").remove([anterior.foto_path as string]);
  }

  /* El arte subido tiene que llegarle a Eduardo sin que nadie se acuerde de
     ligarlo a mano: liga el pedido de maquila (que es lo que le abre la imagen)
     y marca el diseño como listo. Si no puede decidir cuál pedido es, no
     inventa — lo dice y la liga se queda para el detalle del pedido. */
  const arte = await propagarArteDePersonalizado(cx.supabase, id, cx.user.id);
  if (arte.ligados || arte.marcados) revalidatePath("/maquila");

  revalidar();
  return { ok: true, datos: { path, arte } };
}

/* Traer los pedidos personalizados que ya se vendieron y todavía no tienen
   ficha. La ingesta hace esto sola en cada pasada; el botón existe para no
   esperar al cron —y para reintentar si una pasada lo dejó a medias—. */
export async function traerPedidosDeMaquila(): Promise<Resultado<{ creadas: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  try {
    const { creadas } = await sembrarPersonalizadosDeMaquila(cx.supabase);
    if (creadas > 0) {
      revalidar();
      revalidatePath("/maquila"); // allá quedaron ligados a su ficha
    }
    return { ok: true, datos: { creadas } };
  } catch (e) {
    return { error: mensajeDeError(e, "No se pudieron traer los pedidos.") };
  }
}

/* El bucket es privado: la vista pide un enlace temporal para pintar la foto. */
export async function urlFotoPersonalizado(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  return urlFirmada(cx.supabase, "personalizados", path);
}

/* Liga del diseño para MANDARSE por WhatsApp al proveedor (Eduardo). Dura 7
   días y no 1 hora: la abre él cuando le toque el pedido, no al instante. */
const SIETE_DIAS = 7 * 24 * 60 * 60;
export async function ligaDisenoParaProveedor(
  path: string,
): Promise<{ url: string } | { error: string }> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;
  return urlFirmada(cx.supabase, "personalizados", path, SIETE_DIAS);
}

/* ---------------------------------------------------------------------------
   Importar la hoja «Personalizados FRESA FIT».
   Se pega el bloque completo y cada fila es un pedido. Lo único que no viaja es
   la imagen del diseño (en la hoja es una imagen incrustada): queda pendiente
   por ficha, que es como se sube desde aquí.
   --------------------------------------------------------------------------- */
export type FilaPersonalizadoInput = {
  no_venta: string;
  cliente: string;
  modelo: ModeloPersonalizadoId | null;
  talla: string;
  fecha_compra: string | null;
  fecha_produccion: string | null;
  fecha_limite: string | null;
  url: string;
  estado: EstadoPersonalizadoId;
  notas: string;
};

export async function importarPersonalizados(
  filas: FilaPersonalizadoInput[],
): Promise<Resultado<{ creados: number; omitidos: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const utiles = filas.filter((f) => f.cliente.trim());
  if (!utiles.length) return { error: "No hay filas con nombre de cliente." };

  /* La hoja repite el mismo pedido cuando lleva dos cinturones (el #4728 sale
     dos veces): se importa una sola vez por número de venta + cliente, y las
     repeticiones se reportan como omitidas para que nadie las dé por perdidas. */
  const { data: existentes } = await cx.supabase
    .from("personalizados")
    .select("cliente, no_venta");
  const llave = (venta: string, cliente: string) =>
    `${venta.trim().toLowerCase()}|${cliente.trim().toLowerCase()}`;
  const vistas = new Set(
    ((existentes ?? []) as { cliente: string; no_venta: string | null }[]).map((p) =>
      llave(p.no_venta ?? "", p.cliente),
    ),
  );

  const nuevas: TablesInsert<"personalizados">[] = [];
  let omitidos = 0;
  for (const f of utiles) {
    const k = llave(f.no_venta, f.cliente);
    if (vistas.has(k)) {
      omitidos++;
      continue;
    }
    vistas.add(k);
    nuevas.push({
      cliente: f.cliente.trim(),
      modelo: f.modelo,
      talla: textoONulo(f.talla),
      no_venta: textoONulo(f.no_venta),
      fecha_compra: f.fecha_compra,
      fecha_produccion: f.fecha_produccion,
      fecha_limite: f.fecha_limite,
      url: textoONulo(f.url),
      estado: f.estado,
      notas: textoONulo(f.notas),
      created_by: cx.user.id,
    });
  }

  if (!nuevas.length) return { ok: true, datos: { creados: 0, omitidos } };

  const { error } = await cx.supabase.from("personalizados").insert(nuevas);
  if (error) return { error: error.message };

  revalidar();
  return { ok: true, datos: { creados: nuevas.length, omitidos } };
}

/* ===================== Elegir la venta de la que salió ==================== */

/* Un candidato del buscador de ventas del diálogo. */
export type VentaCandidata = {
  id: string;
  /* El folio VISIBLE al cliente ("4728"): lo que se copia hoy a mano y lo que
     se sigue guardando en `no_venta`. Puede faltar en órdenes viejas. */
  numero: string | null;
  /* El id de la orden en la plataforma; sirve de respaldo cuando no hay folio. */
  referencia_orden: string;
  canal: string;
  fecha: string;
  cliente: string | null;
};

/* Buscar entre las ventas ya importadas para no teclear el número a mano.

   Va contra `sale_orders` y NO contra `sales`: `sales` guarda un renglón por
   PRODUCTO vendido y su `referencia_externa` es "<order_id>:<variant_id>", así
   que buscar «4728» ahí no encuentra nada. El folio que la gente copia del panel
   de la tienda vive en `sale_orders.numero`.

   Devuelve un puñado y no una lista: son miles de órdenes y no pueden viajar con
   la página, igual que los personalizados se BUSCAN desde maquila en vez de
   listarse. Por eso también el mínimo de dos caracteres: con uno solo, cualquier
   cosa coincide y la propuesta no ayuda. */
export async function buscarVentas(
  texto: string,
): Promise<Resultado<{ ventas: VentaCandidata[] }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const q = texto.trim();
  if (q.length < 2) return { ok: true, datos: { ventas: [] } };
  /* Los comodines de PostgREST se escapan: un «%» tecleado traería todo. */
  const patron = `%${q.replace(/[%_,]/g, "")}%`;
  if (patron === "%%") return { ok: true, datos: { ventas: [] } };

  const columnas = "id, numero, referencia_orden, canal, fecha, cliente:customers!cliente_id(nombre)";

  /* Primero por folio, después por nombre de cliente: dos consultas y no un
     `.or()` porque el orden de preferencia importa —un match de número vale más
     que uno de nombre— y el `or` sobre una tabla embebida no filtra el padre. */
  const porNumero = await cx.supabase
    .from("sale_orders")
    .select(columnas)
    .or(`numero.ilike.${patron},referencia_orden.ilike.${patron}`)
    .order("fecha", { ascending: false })
    .order("id")
    .limit(12);
  if (porNumero.error) return { error: porNumero.error.message };
  if (porNumero.data?.length) {
    return { ok: true, datos: { ventas: aCandidatas(porNumero.data) } };
  }

  /* Por cliente van DOS consultas —primero los clientes, luego sus órdenes— en
     vez de filtrar por la tabla embebida: un filtro sobre un embed que no es
     `!inner` no recorta al padre, así que el `limit` se gastaría en órdenes que
     no casan y la búsqueda devolvería vacío teniendo resultados. */
  const clientes = await cx.supabase
    .from("customers")
    .select("id")
    .ilike("nombre", patron)
    .limit(20);
  if (clientes.error) return { error: clientes.error.message };

  const ids = (clientes.data ?? []).map((c) => c.id as string);
  if (!ids.length) return { ok: true, datos: { ventas: [] } };

  const porCliente = await cx.supabase
    .from("sale_orders")
    .select(columnas)
    .in("cliente_id", ids)
    .order("fecha", { ascending: false })
    .order("id")
    .limit(12);
  if (porCliente.error) return { error: porCliente.error.message };
  return { ok: true, datos: { ventas: aCandidatas(porCliente.data ?? []) } };
}

type FilaOrden = {
  id: string;
  numero: string | null;
  referencia_orden: string;
  canal: string;
  fecha: string;
  cliente: { nombre: string } | { nombre: string }[] | null;
};

function aCandidatas(filas: unknown[]): VentaCandidata[] {
  return (filas as FilaOrden[]).map((f) => ({
    id: f.id,
    numero: f.numero,
    referencia_orden: f.referencia_orden,
    canal: f.canal,
    fecha: f.fecha,
    cliente: Array.isArray(f.cliente) ? (f.cliente[0]?.nombre ?? null) : (f.cliente?.nombre ?? null),
  }));
}
