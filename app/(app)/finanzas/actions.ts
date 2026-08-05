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
import type { CategoriaGastoId, EstadoComprobanteId, ExpenseReceipt } from "@/lib/types";

export type GastoInput = {
  fecha: string;
  concepto: string;
  monto: number;
  categoria: CategoriaGastoId;
  proveedor: string;
  notas: string;
  /* De la hoja «Facturas FRESA FIT»: con qué se pagó y qué papel falta. */
  metodo_pago: string;
  factura: EstadoComprobanteId;
  recibo: EstadoComprobanteId;
};

/* Todo el módulo es administrativo: cada action pasa por exigirRol("admin") con
   este mismo mensaje. La BD lo refuerza con RLS (policies es_administrativo) —
   esto es defensa en profundidad. */
const NO_AUTORIZADO = "Solo dirección o administración puede ver y mover las finanzas.";

/* ============================ Gastos ====================================== */

export async function guardarGasto(id: string | null, input: GastoInput): Promise<Resultado> {
  const cx = await exigirRol("admin", NO_AUTORIZADO);
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
    metodo_pago: textoONulo(input.metodo_pago),
    factura: input.factura,
    recibo: input.recibo,
  };

  const { error } = id
    ? await cx.supabase.from("expenses").update(fila).eq("id", id)
    : await cx.supabase.from("expenses").insert({ ...fila, created_by: cx.user.id });

  if (error) return { error: error.message };
  revalidatePath("/finanzas");
  return { ok: true };
}

/* Pegar el bloque de la hoja «Facturas FRESA FIT». Nada de lo que ya esté
   capturado se toca: se compara por concepto + fecha + monto, que es lo que
   hace único a un gasto en esa hoja. */
export type FilaGastoInput = {
  fecha: string;
  concepto: string;
  monto: number;
  categoria: CategoriaGastoId;
  metodo_pago: string;
  factura: EstadoComprobanteId;
  recibo: EstadoComprobanteId;
};

export async function importarGastos(
  filas: FilaGastoInput[],
): Promise<Resultado<{ creados: number; omitidos: number }>> {
  const cx = await exigirRol("admin", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  const utiles = filas.filter((f) => f.concepto.trim() && f.fecha);
  if (!utiles.length) return { error: "No hay renglones con concepto y fecha para importar." };

  const { data: existentes } = await cx.supabase.from("expenses").select("concepto, fecha, monto");
  const llave = (concepto: string, fecha: string, monto: number) =>
    `${concepto.trim().toLowerCase()}|${fecha}|${monto.toFixed(2)}`;
  const vistos = new Set(
    ((existentes ?? []) as { concepto: string; fecha: string; monto: number }[]).map((g) =>
      llave(g.concepto, g.fecha, Number(g.monto)),
    ),
  );

  const nuevos: Record<string, unknown>[] = [];
  let omitidos = 0;
  for (const f of utiles) {
    const k = llave(f.concepto, f.fecha, f.monto);
    if (vistos.has(k)) {
      omitidos++;
      continue;
    }
    vistos.add(k);
    nuevos.push({
      fecha: f.fecha,
      concepto: f.concepto.trim(),
      monto: f.monto,
      categoria: f.categoria,
      metodo_pago: textoONulo(f.metodo_pago),
      factura: f.factura,
      recibo: f.recibo,
      created_by: cx.user.id,
    });
  }

  if (!nuevos.length) return { ok: true, datos: { creados: 0, omitidos } };

  const { error } = await cx.supabase.from("expenses").insert(nuevos);
  if (error) return { error: error.message };

  revalidatePath("/finanzas");
  return { ok: true, datos: { creados: nuevos.length, omitidos } };
}

export async function borrarGasto(id: string): Promise<Resultado> {
  const cx = await exigirRol("admin", NO_AUTORIZADO);
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
  const cx = await exigirRol("admin", NO_AUTORIZADO);
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
  const cx = await exigirRol("admin", NO_AUTORIZADO);
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
  const cx = await exigirRol("admin", NO_AUTORIZADO);
  if ("error" in cx) return cx;

  return urlFirmada(cx.supabase, "facturas", storagePath);
}
