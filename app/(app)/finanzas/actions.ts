"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import {
  archivoDeFormData,
  rutaParaArchivo,
  subirYRegistrar,
  borrarArchivoYFila,
  urlFirmada,
} from "@/lib/storage";
import { textoONulo } from "@/lib/validacion";
import type { CategoriaGastoId, ExpenseReceipt } from "@/lib/types";

export type GastoInput = {
  fecha: string;
  concepto: string;
  monto: number;
  categoria: CategoriaGastoId;
  proveedor: string;
  notas: string;
};

/* Todo el módulo es de dirección: cada action pasa por exigirRol("direccion")
   con este mismo mensaje. La BD lo refuerza con RLS (policies es_admin) —
   esto es defensa en profundidad. */
const NO_AUTORIZADO = "Solo Dirección puede ver y mover las finanzas.";

/* ============================ Gastos ====================================== */

export async function guardarGasto(id: string | null, input: GastoInput): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const concepto = input.concepto.trim();
  if (!concepto) return { error: "El gasto necesita un concepto (qué se pagó)." };
  if (!input.fecha) return { error: "Falta la fecha del gasto." };
  if (!Number.isFinite(input.monto) || input.monto < 0) return { error: "El monto no puede ser negativo." };

  const fila = {
    fecha: input.fecha,
    concepto,
    monto: input.monto,
    categoria: input.categoria,
    proveedor: textoONulo(input.proveedor),
    notas: textoONulo(input.notas),
  };

  const { error } = id
    ? await cx.supabase.from("expenses").update(fila).eq("id", id)
    : await cx.supabase.from("expenses").insert({ ...fila, created_by: cx.user.id });

  if (error) return { error: error.message };
  revalidatePath("/finanzas");
  return { ok: true };
}

export async function borrarGasto(id: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  /* Los comprobantes se van en cascada en la BD; hay que limpiar los binarios. */
  const { data: comprobantes } = await cx.supabase
    .from("expense_receipts")
    .select("storage_path")
    .eq("expense_id", id);
  const rutas = (comprobantes ?? []).map((c) => c.storage_path as string);
  if (rutas.length > 0) await cx.supabase.storage.from("facturas").remove(rutas);

  const { error } = await cx.supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finanzas");
  return { ok: true };
}

/* ============================ Comprobantes (Storage) ====================== */

/* Devuelve el comprobante creado para que el diálogo abierto lo pinte al
   instante (sus props son una foto del gasto anterior a la subida). */
export async function subirComprobante(
  expenseId: string,
  formData: FormData,
): Promise<{ ok: true; comprobante: ExpenseReceipt } | { error: string }> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const archivo = archivoDeFormData(formData);
  if ("error" in archivo) return archivo;
  const { file } = archivo;

  const path = rutaParaArchivo(expenseId, file.name);
  const r = await subirYRegistrar<ExpenseReceipt>({
    supabase: cx.supabase,
    bucket: "facturas",
    path,
    file,
    insertar: () =>
      cx.supabase
        .from("expense_receipts")
        .insert({
          expense_id: expenseId,
          nombre: file.name,
          storage_path: path,
          tipo: file.type || null,
        })
        .select("*")
        .single(),
    errorRegistro: "No se pudo registrar el comprobante.",
  });
  if ("error" in r) return r;

  revalidatePath("/finanzas");
  return { ok: true, comprobante: r.datos };
}

export async function borrarComprobante(id: string, storagePath: string): Promise<Resultado> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const r = await borrarArchivoYFila({
    supabase: cx.supabase,
    bucket: "facturas",
    path: storagePath,
    tabla: "expense_receipts",
    id,
  });
  if ("error" in r) return r;

  revalidatePath("/finanzas");
  return { ok: true };
}

/* URL firmada temporal (1 h) para ver o descargar un comprobante. */
export async function urlComprobante(
  storagePath: string,
): Promise<{ url: string } | { error: string }> {
  const cx = await exigirRol("direccion", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  return urlFirmada(cx.supabase, "facturas", storagePath);
}
