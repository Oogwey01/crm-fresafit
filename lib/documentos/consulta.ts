/* ============================================================================
   lib/documentos/consulta.ts — Leer el archivo de una empresa
   ----------------------------------------------------------------------------
   Lo comparten las dos caras del módulo: la pestaña del equipo
   (/agencia/clientes/[slug]) y el portal del cliente (/portal/documentos). Las
   dos hacen la MISMA consulta —sin un solo filtro de visibilidad— y la RLS es
   la que devuelve cosas distintas a cada quien. Un archivo compartido es
   exactamente eso: el mismo dato mirado desde dos sesiones.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { traerTodo } from "@/lib/canales/paginacion";
import type {
  EmpresaDocumento,
  EmpresaDocumentoConVersion,
  EmpresaDocumentoVersion,
  Profile,
} from "@/lib/types";

type Cliente = SupabaseClient<Database>;

/* Columnas explícitas, como en el resto del CRM: una columna nueva y pesada no
   debe colarse a todas las pantallas sin que nadie lo pida. */
export const COLUMNAS_DOCUMENTO =
  "id, empresa_id, nombre, categoria, descripcion, etiquetas, visibilidad," +
  " vigente_hasta, aviso_vencimiento_en, archivado_at, created_by, created_at, updated_at";

export const COLUMNAS_VERSION =
  "id, documento_id, version, storage_path, nombre_archivo, mime, tamano, nota," +
  " subido_por, created_at";

/* Los documentos de una empresa con su versión vigente resuelta.

   Dos consultas y no un embed con `order/limit`: PostgREST no sabe traer «la
   última fila de cada grupo» en un embed, y pedir todas las versiones de todos
   los documentos es barato (son unas pocas por documento) comparado con una
   consulta por documento. Ambas van paginadas — el corte de ~1000 filas no
   avisa, y un cliente de dos años pasa ese número. */
export async function documentosDeEmpresa(
  supabase: Cliente,
  empresaId: string,
  opciones: { incluirArchivados?: boolean } = {},
): Promise<EmpresaDocumentoConVersion[]> {
  const documentos = await traerTodo<EmpresaDocumento>((desde, hasta) => {
    let q = supabase
      .from("empresa_documentos")
      .select(COLUMNAS_DOCUMENTO)
      .eq("empresa_id", empresaId);
    if (!opciones.incluirArchivados) q = q.is("archivado_at", null);
    return q.order("created_at", { ascending: false }).order("id").range(desde, hasta);
  });

  if (!documentos.length) return [];

  const ids = documentos.map((d) => d.id);
  const [versiones, autores] = await Promise.all([
    traerTodo<EmpresaDocumentoVersion>((desde, hasta) =>
      supabase
        .from("empresa_documento_versiones")
        .select(COLUMNAS_VERSION)
        .in("documento_id", ids)
        .order("documento_id")
        .order("version", { ascending: false })
        .range(desde, hasta),
    ),
    supabase
      .from("profiles")
      .select("id, nombre, color")
      .in("id", documentos.map((d) => d.created_by).filter(Boolean) as string[]),
  ]);

  const porDoc = new Map<string, EmpresaDocumentoVersion[]>();
  for (const v of versiones) {
    const lista = porDoc.get(v.documento_id) ?? [];
    lista.push(v);
    porDoc.set(v.documento_id, lista);
  }

  const perfiles = new Map(
    ((autores.data ?? []) as Pick<Profile, "id" | "nombre" | "color">[]).map((p) => [p.id, p]),
  );

  return documentos.map((d) => {
    const lista = porDoc.get(d.id) ?? [];
    return {
      ...d,
      /* Vienen ordenadas por versión descendente, así que la vigente es la
         primera. Un documento sin versiones no debería existir (se crean juntos)
         pero puede pasar si la subida del binario falló a medias. */
      version_actual: lista[0] ?? null,
      total_versiones: lista.length,
      autor: d.created_by ? (perfiles.get(d.created_by) ?? null) : null,
    };
  });
}

/* Todas las versiones de un documento, de la más nueva a la más vieja. Es lo
   que se enseña al abrir el histórico. */
export async function versionesDeDocumento(
  supabase: Cliente,
  documentoId: string,
): Promise<EmpresaDocumentoVersion[]> {
  const { data, error } = await supabase
    .from("empresa_documento_versiones")
    .select(COLUMNAS_VERSION)
    .eq("documento_id", documentoId)
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EmpresaDocumentoVersion[];
}

/* ¿Cuántos días le quedan de vigencia? Negativo = ya venció; null = no caduca.
   Se calcula sobre fechas en la zona del negocio (lib/fecha.ts ancla todo a
   America/Mexico_City): en UTC, un documento que vence hoy se vería vencido
   desde las 6 de la tarde de ayer. */
export function diasDeVigencia(vigenteHasta: string | null, hoyISO: string): number | null {
  if (!vigenteHasta) return null;
  const ms = Date.parse(`${vigenteHasta}T12:00:00Z`) - Date.parse(`${hoyISO}T12:00:00Z`);
  return Math.round(ms / 86_400_000);
}
