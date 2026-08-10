"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { archivoDeFormData, rutaParaArchivo, urlFirmada } from "@/lib/storage";
import { revalidar } from "@/app/(app)/maquila/acciones/comun";

/* Las guías de maquila: el pendiente que logística le surte a Eduardo.
   Escribe el equipo interno (subir el archivo y el número); el maquilero solo
   descarga —por eso `urlGuiaMaquila` es lo único de aquí con nivel "maquila"—.

   El bucket es privado y las policies cortan por carpeta (guias/ y disenos/
   sí, anticipos/ no): ver 20260926000000_maquila_storage.sql. */

const BUCKET = "maquila";

/* Sube el archivo que Eduardo va a imprimir y captura la guía de una vez.
   Guardar el número aquí —y no cuando él marca enviado— es lo que hace que
   el trigger de maquila_pedidos lo deje avanzar sin volver a teclearlo.

   La guía es del PAQUETE: se propaga a todos los renglones de la orden que
   estén terminados y sin guía propia, igual que hace capturarGuiaMaquila. Los
   que sigan en producción no se tocan: saldrán con su propio envío. */
export async function subirGuiaMaquila(
  guiaId: string,
  formData: FormData,
): Promise<Resultado<{ pedidos: number }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const paqueteria = String(formData.get("paqueteria") ?? "");
  const numGuia = String(formData.get("num_guia") ?? "").trim();
  if (!numGuia) return { error: "Falta el número de guía." };

  const archivo = archivoDeFormData(formData, {
    maxMB: 10,
    mensajeExcedido: "La guía supera 10 MB. Exporta el PDF más ligero.",
  });
  if ("error" in archivo) return archivo;
  const { file } = archivo;
  if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
    return { error: "La guía debe ser un PDF o una imagen." };
  }

  const { data: guia, error: errGuia } = await cx.supabase
    .from("maquila_guias")
    .select("id, canal, grupo, estado, archivo_path")
    .eq("id", guiaId)
    .single();
  if (errGuia || !guia) return { error: errGuia?.message ?? "Esa solicitud ya no existe." };
  if (guia.estado === "cancelada" || guia.estado === "entregada") {
    return { error: "Esa solicitud ya está cerrada." };
  }

  const path = rutaParaArchivo(`guias/${guiaId}`, file.name);
  const { error: errSubida } = await cx.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (errSubida) return { error: errSubida.message };

  const { error } = await cx.supabase
    .from("maquila_guias")
    .update({
      estado: "cargada",
      paqueteria: textoONulo(paqueteria),
      num_guia: numGuia,
      archivo_path: path,
      archivo_nombre: file.name,
      archivo_mime: file.type || null,
      cargada_por: cx.user.id,
      cargada_en: new Date().toISOString(),
    })
    .eq("id", guiaId);
  if (error) {
    /* Sin fila que lo apunte, el binario es basura: se deshace. */
    await cx.supabase.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }

  /* El archivo viejo se tira DESPUÉS de que la fila apunta al nuevo: si esto
     falla, sobra un binario, que es mucho más barato que quedarse sin guía. */
  if (guia.archivo_path) await cx.supabase.storage.from(BUCKET).remove([guia.archivo_path]);

  /* Y el número baja a los renglones del paquete que ya estén listos. El
     `grupo` es la referencia de la orden o, cuando no hay orden (captura
     manual suelta), el id del propio pedido: son dos columnas de tipos
     distintos, así que se filtran por separado —un `.or()` compararía un
     texto de orden contra la columna uuid y Postgres lo rechazaría—. */
  const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guia.grupo);
  const cambio = { paqueteria: textoONulo(paqueteria), num_guia: numGuia };
  const base = () =>
    cx.supabase
      .from("maquila_pedidos")
      .update(cambio)
      .eq("canal", guia.canal)
      .eq("estado", "terminado")
      .is("num_guia", null);

  const { data: tocados, error: errPedidos } = esUuid
    ? await base().eq("id", guia.grupo).select("id")
    : await base().eq("referencia_orden", guia.grupo).select("id");

  revalidar();
  if (errPedidos) {
    return {
      ok: true,
      advertencia: `Guía guardada, pero no se pudo copiar a los pedidos: ${errPedidos.message}`,
      datos: { pedidos: 0 },
    };
  }
  return { ok: true, datos: { pedidos: tocados?.length ?? 0 } };
}

/* La liga temporal para ver o imprimir la guía. Nivel "maquila" porque es la
   única acción del módulo que Eduardo necesita de este archivo; la RLS del
   bucket vuelve a comprobar que la carpeta sea `guias`. */
export async function urlGuiaMaquila(guiaId: string): Promise<Resultado<{ url: string }>> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("maquila_guias")
    .select("archivo_path")
    .eq("id", guiaId)
    .single();
  if (error || !data?.archivo_path) return { error: "Esa guía todavía no tiene archivo." };

  const firmada = await urlFirmada(cx.supabase, BUCKET, data.archivo_path);
  if ("error" in firmada) return firmada;
  return { ok: true, datos: { url: firmada.url } };
}

/* Cerrar una solicitud sin surtirla: el paquete se canceló, o se mandó por
   fuera. No borra el histórico —el índice único parcial deja abrir otra. */
export async function cancelarGuiaMaquila(
  guiaId: string,
  motivo: string,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_guias")
    .update({ estado: "cancelada", notas: textoONulo(motivo) })
    .eq("id", guiaId);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
