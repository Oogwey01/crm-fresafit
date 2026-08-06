"use server";

import { revalidatePath } from "next/cache";
import type { TablesInsert, TablesUpdate } from "@/lib/supabase/tipos-bd";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { archivoDeFormData, rutaParaArchivo, urlFirmada } from "@/lib/storage";
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
  revalidar();
  return { ok: true };
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
): Promise<Resultado<{ path: string }>> {
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

  revalidar();
  return { ok: true, datos: { path } };
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
