"use server";

/* Acciones del archivo de documentos.

   Viven bajo /agencia/clientes pero las usan LAS DOS caras del módulo: el equipo
   desde la pestaña del cliente y la empresa desde su portal. No hay dos juegos
   de acciones porque no hay dos reglas: quién puede qué lo decide la RLS
   (20260916000000_portal_documentos.sql), y duplicarlas sería un segundo sitio
   donde arreglar el mismo error.

   La única asimetría está en el alta: lo que sube el cliente nace `compartido`
   —si nos lo manda, es para que lo veamos— y lo que subimos nosotros nace
   `interno`, como todo en este módulo. */

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { archivoDeFormData, subirYRegistrar, urlFirmada } from "@/lib/storage";
import { registrarActividadEmpresa } from "@/lib/actividad";
import { textoONulo } from "@/lib/validacion";
import {
  CATEGORIAS_DOCUMENTO,
  VISIBILIDADES,
  esExterno,
} from "@/lib/catalogos";
import type { CategoriaDocumentoId, VisibilidadId } from "@/lib/types";

const RUTAS = ["/agencia/clientes", "/portal/documentos"];
const revalidar = () => RUTAS.forEach((r) => revalidatePath(r));

/* 25 MB y no los 10 de los adjuntos de tarea: aquí viven contratos escaneados y
   brandbooks, que pesan de verdad. El límite de Supabase Storage por archivo es
   mucho mayor; este es el que evita que alguien suba un video por error. */
const MAX_MB = 25;

/* La ruta del binario. El PRIMER SEGMENTO es el id del documento porque es lo
   que miran las policies de storage.objects (`storage.foldername(name)[1]`),
   igual que el bucket `adjuntos` usa el id de la tarea. */
function rutaVersion(documentoId: string, version: number, nombre: string): string {
  const limpio = nombre.replace(/[^\w.\-]+/g, "_");
  return `${documentoId}/v${version}-${limpio}`;
}

/* --------------------------------------------------------------------------
   Alta: el documento y su primera versión, juntos
   -------------------------------------------------------------------------- */
export async function subirDocumento(formData: FormData): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;

  const externo = esExterno(cx.rol);
  const empresaId = externo
    ? (cx.perfil?.empresa_id ?? "")
    : String(formData.get("empresa_id") ?? "");
  if (!empresaId) return { error: "Falta la empresa." };

  const nombre = String(formData.get("nombre") ?? "").trim();
  if (!nombre) return { error: "El documento necesita un nombre." };

  const categoria = String(formData.get("categoria") ?? "otros") as CategoriaDocumentoId;
  if (!CATEGORIAS_DOCUMENTO.some((c) => c.id === categoria)) {
    return { error: "Esa categoría no existe." };
  }

  /* Lo que sube el cliente es para nosotros; lo nuestro nace interno salvo que
     se diga otra cosa a propósito. */
  const pedida = String(formData.get("visibilidad") ?? "interno") as VisibilidadId;
  const visibilidad: VisibilidadId = externo
    ? "compartido"
    : VISIBILIDADES.some((v) => v.id === pedida)
      ? pedida
      : "interno";

  const archivo = archivoDeFormData(formData, {
    maxMB: MAX_MB,
    mensajeExcedido: `El archivo supera ${MAX_MB} MB. Comprímelo o divídelo.`,
  });
  if ("error" in archivo) return archivo;
  const { file } = archivo;

  /* Primero la ficha, luego el binario: al revés no se sabría a qué carpeta
     subirlo (la ruta lleva el id del documento). Si la subida falla después,
     `subirYRegistrar` deshace su parte y la ficha queda sin versión — se ve en
     la lista como «sin archivo» y se puede completar, que es mejor que un
     binario huérfano al que nadie llega. */
  const { data: doc, error } = await cx.supabase
    .from("empresa_documentos")
    .insert({
      empresa_id: empresaId,
      nombre,
      categoria,
      descripcion: textoONulo(String(formData.get("descripcion") ?? "")),
      etiquetas: etiquetasDe(formData.get("etiquetas")),
      visibilidad,
      vigente_hasta: String(formData.get("vigente_hasta") ?? "") || null,
      created_by: cx.user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  const path = rutaVersion(doc.id, 1, file.name);
  const res = await subirYRegistrar({
    supabase: cx.supabase,
    bucket: "empresas",
    path,
    file,
    insertar: () =>
      cx.supabase
        .from("empresa_documento_versiones")
        .insert({
          documento_id: doc.id,
          version: 1,
          storage_path: path,
          nombre_archivo: file.name,
          mime: file.type || null,
          tamano: file.size,
          subido_por: cx.user.id,
        })
        .select("id")
        .single(),
    errorRegistro: "No se pudo registrar el archivo.",
  });
  if ("error" in res) {
    return { ok: true, advertencia: `Se creó la ficha pero el archivo no subió: ${res.error}` };
  }

  revalidar();
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Versión nueva: reemplazar SIN perder la anterior
   -------------------------------------------------------------------------- */
export async function subirVersion(formData: FormData): Promise<Resultado> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;

  const documentoId = String(formData.get("documento_id") ?? "");
  if (!documentoId) return { error: "Falta el documento." };

  const archivo = archivoDeFormData(formData, {
    maxMB: MAX_MB,
    mensajeExcedido: `El archivo supera ${MAX_MB} MB. Comprímelo o divídelo.`,
  });
  if ("error" in archivo) return archivo;
  const { file } = archivo;

  /* El número lo calcula la BASE y no el navegador: dos personas subiendo a la
     vez pedirían el mismo. Si aun así coinciden, el índice único
     (documento_id, version) frena a la segunda con un error claro. */
  const { data: siguiente, error: errVer } = await cx.supabase.rpc(
    "siguiente_version_documento",
    { did: documentoId },
  );
  if (errVer) return { error: errVer.message };
  const version = Number(siguiente ?? 1);

  const path = rutaVersion(documentoId, version, file.name);
  const res = await subirYRegistrar({
    supabase: cx.supabase,
    bucket: "empresas",
    path,
    file,
    insertar: () =>
      cx.supabase
        .from("empresa_documento_versiones")
        .insert({
          documento_id: documentoId,
          version,
          storage_path: path,
          nombre_archivo: file.name,
          mime: file.type || null,
          tamano: file.size,
          nota: textoONulo(String(formData.get("nota") ?? "")),
          subido_por: cx.user.id,
        })
        .select("id")
        .single(),
    errorRegistro: "No se pudo registrar la versión.",
  });
  if ("error" in res) return res;

  /* Una versión nueva suele venir con vigencia nueva (la constancia de este
     año). Se acepta desde el mismo formulario para no obligar a dos pasos, y se
     limpia el sello del aviso: es otro documento, y volverá a avisar. */
  const vigencia = String(formData.get("vigente_hasta") ?? "");
  if (vigencia) {
    await cx.supabase
      .from("empresa_documentos")
      .update({ vigente_hasta: vigencia, aviso_vencimiento_en: null })
      .eq("id", documentoId);
  }

  revalidar();
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Editar la ficha y compartir
   -------------------------------------------------------------------------- */
export async function editarDocumento(
  id: string,
  datos: {
    nombre: string;
    categoria: CategoriaDocumentoId;
    descripcion: string;
    etiquetas: string[];
    vigente_hasta: string | null;
    visibilidad: VisibilidadId;
  },
): Promise<Resultado> {
  const cx = await exigirRol("interno", "Los datos del documento los edita el equipo de Fresafit.");
  if ("error" in cx) return cx;

  const nombre = datos.nombre.trim();
  if (!nombre) return { error: "El documento necesita un nombre." };

  const { error } = await cx.supabase
    .from("empresa_documentos")
    .update({
      nombre,
      categoria: datos.categoria,
      descripcion: textoONulo(datos.descripcion),
      etiquetas: datos.etiquetas,
      vigente_hasta: datos.vigente_hasta,
      visibilidad: datos.visibilidad,
      /* Cambió la fecha: que vuelva a avisar cuando toque. */
      aviso_vencimiento_en: null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* Archivar y desarchivar. NO hay borrar: el archivo de un cliente es evidencia
   igual que las tareas, y lo que se guarda se queda. */
export async function archivarDocumento(id: string, archivar: boolean): Promise<Resultado> {
  const cx = await exigirRol("interno", "Archivar documentos es del equipo de Fresafit.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("empresa_documentos")
    .update({ archivado_at: archivar ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidar();
  return { ok: true };
}

/* --------------------------------------------------------------------------
   Abrir un archivo
   -------------------------------------------------------------------------- */
/* Toda descarga pasa por aquí, y por eso la UI nunca firma una URL por su
   cuenta: «¿me mandaron esto?» / «yo nunca lo recibí» es media discusión, y
   `actividad_empresas` la cierra. La firma dura una hora, suficiente para verlo
   o guardarlo, y no sirve para repartir el enlace por ahí. */
export async function abrirArchivoDocumento(
  documentoId: string,
  storagePath: string,
): Promise<{ url: string } | { error: string }> {
  const cx = await exigirRol("autenticado");
  if ("error" in cx) return cx;

  const firmada = await urlFirmada(cx.supabase, "empresas", storagePath);
  if ("error" in firmada) return firmada;

  /* La consulta va DESPUÉS de firmar: si el documento no fuera visible, la RLS
     ya habría hecho fallar la firma. */
  const { data: doc } = await cx.supabase
    .from("empresa_documentos")
    .select("empresa_id, nombre")
    .eq("id", documentoId)
    .maybeSingle();

  await registrarActividadEmpresa(cx.supabase, {
    empresaId: doc?.empresa_id ?? null,
    actorId: cx.user.id,
    actorNombre: cx.perfil?.nombre ?? null,
    accion: "documento_descargado",
    entidad: "documento",
    entidadId: documentoId,
    detalle: { nombre: doc?.nombre ?? null, archivo: storagePath },
  });

  return firmada;
}

/* Las etiquetas llegan del formulario como texto separado por comas. */
function etiquetasDe(valor: FormDataEntryValue | null): string[] {
  return String(valor ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}
