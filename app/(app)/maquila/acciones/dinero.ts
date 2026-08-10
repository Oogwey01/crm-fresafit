"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { archivoDeFormData, rutaParaArchivo, urlFirmada } from "@/lib/storage";
import { revalidar } from "@/app/(app)/maquila/acciones/comun";
import type { TipoAnticipoMaquilaId } from "@/lib/types";

/* Lo que se le paga a Eduardo: anticipos y corte quincenal. TODO es de
   administración (dirección + Diana), tanto aquí como en la RLS. Cancelar un
   corte ya calculado se reserva a dirección: libera pedidos y devuelve saldo a
   los anticipos, y eso mueve dinero de dos periodos a la vez.

   Los totales nunca se escriben desde aquí: los mantienen las funciones de la
   base (20260929000000), que son las únicas que ven todos los renglones. */

const BUCKET = "maquila";

/* --- Anticipos ------------------------------------------------------------ */

export type AnticipoMaquilaInput = {
  fecha: string;
  tipo: TipoAnticipoMaquilaId;
  concepto: string;
  monto: number;
  especie_cantidad: number | null;
  especie_unidad: string;
  notas: string;
};

export async function registrarAnticipoMaquila(
  input: AnticipoMaquilaInput,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const concepto = input.concepto.trim();
  if (!concepto) return { error: "Escribe de qué es el anticipo." };
  const monto = Number(input.monto);
  if (!Number.isFinite(monto) || monto < 0) return { error: "El monto no es válido." };

  const { data, error } = await cx.supabase
    .from("maquila_anticipos")
    .insert({
      fecha: input.fecha,
      tipo: input.tipo,
      concepto,
      monto,
      especie_cantidad: input.especie_cantidad,
      especie_unidad: textoONulo(input.especie_unidad),
      notas: textoONulo(input.notas),
      created_by: cx.user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo registrar el anticipo." };
  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export async function subirComprobanteAnticipo(
  anticipoId: string,
  formData: FormData,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const archivo = archivoDeFormData(formData, { maxMB: 10 });
  if ("error" in archivo) return archivo;
  const { file } = archivo;

  const path = rutaParaArchivo(`anticipos/${anticipoId}`, file.name);
  const { error: errSubida } = await cx.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (errSubida) return { error: errSubida.message };

  const { error } = await cx.supabase
    .from("maquila_anticipos")
    .update({ comprobante_path: path, comprobante_nombre: file.name })
    .eq("id", anticipoId);
  if (error) {
    await cx.supabase.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }
  revalidar();
  return { ok: true };
}

export async function urlComprobanteAnticipo(
  anticipoId: string,
): Promise<Resultado<{ url: string }>> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("maquila_anticipos")
    .select("comprobante_path")
    .eq("id", anticipoId)
    .single();
  if (error || !data?.comprobante_path) return { error: "Ese anticipo no tiene comprobante." };

  const firmada = await urlFirmada(cx.supabase, BUCKET, data.comprobante_path);
  if ("error" in firmada) return firmada;
  return { ok: true, datos: { url: firmada.url } };
}

/* Borrar solo si no se ha consumido: un anticipo ya aplicado a un corte
   cerrado es parte de una liquidación pagada, y tirarlo descuadraría el total
   de ese corte. La FK con `on delete cascade` lo borraría en silencio. */
export async function borrarAnticipoMaquila(anticipoId: string): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { data: aplicado, error: errAplicado } = await cx.supabase
    .from("maquila_corte_anticipos")
    .select("corte_id")
    .eq("anticipo_id", anticipoId)
    .eq("anulado", false)
    .limit(1);
  if (errAplicado) return { error: errAplicado.message };
  if (aplicado?.length) {
    return { error: "Ese anticipo ya se aplicó a un corte: cancela el corte antes de borrarlo." };
  }

  const { error } = await cx.supabase.from("maquila_anticipos").delete().eq("id", anticipoId);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* --- El corte ------------------------------------------------------------- */

export async function calcularCorteMaquila(
  desde: string,
  hasta: string,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;
  if (!desde || !hasta) return { error: "Elige la quincena que quieres cortar." };

  const { data, error } = await cx.supabase.rpc("maquila_calcular_corte", { desde, hasta });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true, datos: { id: data as unknown as string } };
}

export async function cerrarCorteMaquila(corteId: string): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.rpc("maquila_cerrar_corte", { cid: corteId });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function agregarAjusteCorte(
  corteId: string,
  concepto: string,
  importe: number,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;
  if (!concepto.trim()) return { error: "Escribe de qué es el ajuste." };
  const n = Number(importe);
  if (!Number.isFinite(n) || n === 0) return { error: "El importe del ajuste no puede ser cero." };

  const { error } = await cx.supabase.rpc("maquila_agregar_ajuste_corte", {
    cid: corteId,
    p_concepto: concepto,
    p_importe: n,
  });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export type PagoCorteInput = {
  pagado_en: string;
  metodo_pago: string;
  factura_folio: string;
  factura_uuid: string;
};

/* Marcar pagado es un UPDATE normal: no recalcula nada, solo sella el hecho.
   Los totales ya quedaron congelados al cerrar. */
export async function marcarCortePagado(
  corteId: string,
  input: PagoCorteInput,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_cortes")
    .update({
      estado: "pagado",
      pagado_en: input.pagado_en || new Date().toISOString(),
      pagado_por: cx.user.id,
      metodo_pago: textoONulo(input.metodo_pago),
      factura_folio: textoONulo(input.factura_folio),
      factura_uuid: textoONulo(input.factura_uuid),
    })
    .eq("id", corteId)
    .eq("estado", "cerrado"); // un borrador no se paga, y un pagado no se re-paga
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function cancelarCorteMaquila(corteId: string): Promise<Resultado> {
  const cx = await exigirRol("direccion");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.rpc("maquila_cancelar_corte", { cid: corteId });
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}
