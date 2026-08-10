"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { archivoDeFormData, rutaParaArchivo, urlFirmada } from "@/lib/storage";
import { revalidar } from "@/app/(app)/maquila/acciones/comun";
import type { AcabadoMaquilaId, Personalizado } from "@/lib/types";

/* El arte que Eduardo necesita para producir, dentro del CRM y no en un chat.
   Dos orígenes:

     * un PERSONALIZADO ligado al pedido — se le abre la imagen que ya existe,
       sin duplicar el binario (la policy del bucket `personalizados` mira la
       liga, ver 20261002000000);
     * un diseño de la BIBLIOTECA de colecciones, que es lo que permite sacar
       una colección sobre venta sin fabricar stock.

   Ligar y marcar listo son del equipo; descargar es nivel "maquila". */

const BUCKET = "maquila";

/* --- Personalizados -------------------------------------------------------- */

export async function ligarPersonalizadoAPedido(
  pedidoId: string,
  personalizadoId: string | null,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_pedidos")
    .update({ personalizado_id: personalizadoId })
    .eq("id", pedidoId);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* El otro origen del arte: un diseño de la biblioteca de colecciones. */
export async function ligarDisenoDeBiblioteca(
  pedidoId: string,
  disenoId: string | null,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_pedidos")
    .update({ diseno_id: disenoId })
    .eq("id", pedidoId);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Candidatos para ligar: se propone por número de venta, que es el único
   punto en común entre las dos tablas (`personalizados.no_venta` es texto
   libre). PROPONE, no aplica: un match por texto no es una certeza. */
export async function sugerirPersonalizados(
  pedidoId: string,
): Promise<Resultado<{ candidatos: Personalizado[] }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { data: pedido, error: errPedido } = await cx.supabase
    .from("maquila_pedidos")
    .select("numero_orden, envio_nombre")
    .eq("id", pedidoId)
    .single();
  if (errPedido || !pedido) return { error: errPedido?.message ?? "Ese pedido ya no existe." };

  const columnas =
    "id, cliente, tipo, modelo, talla, no_venta, canal, fecha_compra, fecha_produccion," +
    " fecha_limite, url, foto_path, estado, notas, responsable_id, created_by, created_at";

  /* Primero por número de venta; si no hay, por nombre del cliente. Dos
     consultas y no un `.or()` porque el orden de preferencia importa: un
     match de folio vale más que uno de nombre. */
  const porOrden = pedido.numero_orden
    ? await cx.supabase
        .from("personalizados")
        .select(columnas)
        .ilike("no_venta", `%${pedido.numero_orden}%`)
        .limit(10)
    : null;
  if (porOrden?.data?.length) {
    return { ok: true, datos: { candidatos: porOrden.data as unknown as Personalizado[] } };
  }

  const porCliente = pedido.envio_nombre
    ? await cx.supabase
        .from("personalizados")
        .select(columnas)
        .ilike("cliente", `%${pedido.envio_nombre}%`)
        .limit(10)
    : null;
  return {
    ok: true,
    datos: { candidatos: (porCliente?.data ?? []) as unknown as Personalizado[] },
  };
}

/* «Producto listo de parte de Fresa Fit»: el arte quedó entregado y de aquí en
   adelante el reloj corre para el taller. Se puede deshacer (marcar de nuevo
   como no listo) porque a veces el arte se rechaza después. */
export async function marcarDisenoListo(
  pedidoId: string,
  listo: boolean,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_pedidos")
    .update({
      diseno_listo_en: listo ? new Date().toISOString() : null,
      diseno_listo_por: listo ? cx.user.id : null,
    })
    .eq("id", pedidoId);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* --- La biblioteca de colecciones ------------------------------------------ */

export type DisenoMaquilaInput = {
  nombre: string;
  coleccion: string;
  acabado: AcabadoMaquilaId | null;
  notas: string;
  activo: boolean;
};

export async function guardarDisenoMaquila(
  input: DisenoMaquilaInput,
  disenoId?: string,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const nombre = input.nombre.trim();
  if (!nombre) return { error: "Falta el nombre del diseño." };

  const fila = {
    nombre,
    coleccion: textoONulo(input.coleccion),
    acabado: input.acabado,
    notas: textoONulo(input.notas),
    activo: input.activo,
  };

  if (disenoId) {
    const { error } = await cx.supabase.from("maquila_disenos").update(fila).eq("id", disenoId);
    if (error) return { error: error.message };
    revalidar();
    return { ok: true, datos: { id: disenoId } };
  }

  const { data, error } = await cx.supabase
    .from("maquila_disenos")
    .insert({ ...fila, created_by: cx.user.id })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo guardar el diseño." };
  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export async function subirArchivoDiseno(
  disenoId: string,
  formData: FormData,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const archivo = archivoDeFormData(formData, {
    maxMB: 25,
    mensajeExcedido: "El arte supera 25 MB. Sube una versión para imprenta más ligera.",
  });
  if ("error" in archivo) return archivo;
  const { file } = archivo;

  const { data: previo } = await cx.supabase
    .from("maquila_disenos")
    .select("archivo_path")
    .eq("id", disenoId)
    .single();

  const path = rutaParaArchivo(`disenos/${disenoId}`, file.name);
  const { error: errSubida } = await cx.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (errSubida) return { error: errSubida.message };

  const { error } = await cx.supabase
    .from("maquila_disenos")
    .update({ archivo_path: path, archivo_nombre: file.name, archivo_mime: file.type || null })
    .eq("id", disenoId);
  if (error) {
    await cx.supabase.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }

  if (previo?.archivo_path) await cx.supabase.storage.from(BUCKET).remove([previo.archivo_path]);
  revalidar();
  return { ok: true };
}

/* La liga para descargar el arte de un pedido. Nivel "maquila": es el camino
   por el que Eduardo baja el diseño en vez de pedirlo por WhatsApp. Resuelve
   los dos orígenes y la RLS vuelve a comprobar cada uno por su lado. */
export async function urlDisenoDePedido(
  pedidoId: string,
): Promise<Resultado<{ url: string; nombre: string }>> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  const { data: pedido, error } = await cx.supabase
    .from("maquila_pedidos")
    .select("personalizado_id, diseno_id")
    .eq("id", pedidoId)
    .single();
  if (error || !pedido) return { error: error?.message ?? "Ese pedido ya no existe." };

  if (pedido.diseno_id) {
    const { data } = await cx.supabase
      .from("maquila_disenos")
      .select("archivo_path, archivo_nombre")
      .eq("id", pedido.diseno_id)
      .single();
    if (data?.archivo_path) {
      const firmada = await urlFirmada(cx.supabase, BUCKET, data.archivo_path);
      if ("error" in firmada) return firmada;
      return { ok: true, datos: { url: firmada.url, nombre: data.archivo_nombre ?? "diseño" } };
    }
  }

  if (pedido.personalizado_id) {
    const { data } = await cx.supabase
      .from("personalizados")
      .select("foto_path")
      .eq("id", pedido.personalizado_id)
      .single();
    if (data?.foto_path) {
      const firmada = await urlFirmada(cx.supabase, "personalizados", data.foto_path);
      if ("error" in firmada) return firmada;
      return { ok: true, datos: { url: firmada.url, nombre: "diseño personalizado" } };
    }
  }

  return { error: "Este pedido todavía no tiene diseño cargado." };
}
