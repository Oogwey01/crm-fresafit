"use server";

import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { diaMX, horaMX } from "@/lib/fecha";
import { obtenerModeloMaquila } from "@/lib/catalogos";
import { clasificarPago } from "@/lib/maquila/reglas";
import { cargarCalendarioMaquila } from "@/lib/maquila/consultas";
import type { TablesInsert, TablesUpdate } from "@/lib/supabase/tipos-bd";
import type {
  AcabadoMaquilaId,
  ColorPalancaId,
  ComboMaquilaId,
  EstadoMaquilaId,
  EventoMaquila,
  ModeloMaquilaId,
  SubestadoMaquilaId,
} from "@/lib/types";
import { fijarCosto, revalidar } from "@/app/(app)/maquila/acciones/comun";

/* Las acciones del pedido piden nivel "maquila" (equipo interno O Eduardo): el
   recorte fino no vive aquí sino en la BD — la RLS decide qué filas alcanza
   cada quien y el trigger validar_cambio_maquila qué columnas y transiciones.
   Un UPDATE que la BD rechaza regresa su mensaje tal cual al toast. */

export async function cambiarEstadoMaquila(
  id: string,
  estado: EstadoMaquilaId,
): Promise<Resultado> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  /* Cancelar y marcar devuelto pasan por cancelarPedidoMaquila (admin), y
     esperando_pago lo pone solo el sistema: esta acción mueve PRODUCCIÓN. */
  if (["esperando_pago", "cancelado", "devuelto"].includes(estado)) {
    return { error: "Ese estado se cambia desde el detalle del pedido." };
  }

  const { error } = await cx.supabase.from("maquila_pedidos").update({ estado }).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

export async function cambiarSubestadoMaquila(
  id: string,
  subestado: SubestadoMaquilaId,
): Promise<Resultado> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("maquila_pedidos").update({ subestado }).eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* Capturar la guía ES marcar enviado: es el paso 5 del flujo ("Eduardo captura
   guía") y separarlos dejaba pedidos con guía que nadie movió. La guía se
   propaga a los renglones HERMANOS de la misma orden que ya estén terminados y
   sin guía propia — viajan en el mismo paquete—; los que sigan en producción
   no se tocan: saldrán con su propio envío. */
export async function capturarGuiaMaquila(
  id: string,
  paqueteria: string,
  numGuia: string,
): Promise<Resultado<{ hermanos: number }>> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  const guia = numGuia.trim();
  if (!guia) return { error: "Falta el número de guía." };
  const cambio = {
    paqueteria: textoONulo(paqueteria),
    num_guia: guia,
    estado: "enviado" as const,
  };

  const { data: pedido, error } = await cx.supabase
    .from("maquila_pedidos")
    .update(cambio)
    .eq("id", id)
    .select("canal, referencia_orden")
    .single();
  if (error || !pedido) return { error: error?.message ?? "No se pudo guardar la guía." };

  let hermanos = 0;
  if (pedido.referencia_orden) {
    const { data, error: errHermanos } = await cx.supabase
      .from("maquila_pedidos")
      .update(cambio)
      .eq("canal", pedido.canal)
      .eq("referencia_orden", pedido.referencia_orden)
      .neq("id", id)
      .eq("estado", "terminado")
      .is("num_guia", null)
      .select("id");
    /* Si un hermano no se pudo mover, la guía principal YA quedó: se avisa en
       vez de fingir que todo falló. */
    if (errHermanos) {
      revalidar();
      return { ok: true, advertencia: `Guía guardada, pero un renglón hermano no se pudo marcar: ${errHermanos.message}`, datos: { hermanos: 0 } };
    }
    hermanos = data?.length ?? 0;
  }

  revalidar();
  return { ok: true, datos: { hermanos } };
}

export type PedidoManualInput = {
  diseno: string;
  modelo: ModeloMaquilaId;
  acabado: AcabadoMaquilaId;
  sku: string;
  talla: string;
  color: string;
  cantidad: number;
  palanca_color: ColorPalancaId | null;
  combo: ComboMaquilaId;
  combo_diseno: string;
  envio_nombre: string;
  envio_telefono: string;
  envio_direccion: string; // libre, en una línea: viene de un chat de WhatsApp
  notas: string;
  /* ISO del instante de pago si ya está pagado; null = queda esperando pago. */
  pagado_en: string | null;
};

/* Alta manual: ventas por WhatsApp o DM que no pasan por ningún canal. Si ya
   está pagada, la clasificación corre AQUÍ MISMO con las mismas reglas que la
   ingesta — una sola manera de calcular fechas. */
export async function crearPedidoMaquila(
  input: PedidoManualInput,
): Promise<Resultado<{ id: string }>> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const diseno = input.diseno.trim();
  if (!diseno) return { error: "Falta el diseño del cinturón." };
  const cantidad = Math.max(1, Math.trunc(Number(input.cantidad) || 1));

  const fila: TablesInsert<"maquila_pedidos"> = {
    canal: "manual",
    origen: "manual",
    referencia_externa: null,
    diseno,
    modelo: input.modelo,
    acabado: input.acabado,
    sku: textoONulo(input.sku),
    talla: textoONulo(input.talla),
    color: textoONulo(input.color),
    cantidad,
    requiere_palanca: obtenerModeloMaquila(input.modelo)?.llevaPalanca ?? false,
    palanca_color: input.palanca_color,
    combo: input.combo,
    combo_diseno: textoONulo(input.combo_diseno),
    envio_nombre: textoONulo(input.envio_nombre),
    envio_telefono: textoONulo(input.envio_telefono),
    envio_direccion: textoONulo(input.envio_direccion)
      ? { calle: input.envio_direccion.trim() }
      : null,
    notas: textoONulo(input.notas),
    estado: "esperando_pago",
    created_by: cx.user.id,
  };

  if (input.pagado_en) {
    const { cal } = await cargarCalendarioMaquila(cx.supabase);
    const cls = clasificarPago(
      diaMX(input.pagado_en),
      horaMX(input.pagado_en),
      input.acabado,
      cal,
    );
    fila.pagado_en = input.pagado_en;
    fila.estado = "pendiente_produccion";
    fila.ruta = cls.ruta;
    fila.corte_fecha = cls.corteFecha;
    fila.fecha_prometida = cls.fechaPrometida;
  }

  const { data, error } = await cx.supabase
    .from("maquila_pedidos")
    .insert(fila)
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "No se pudo crear el pedido." };

  /* La tarifa la congela la base: quien captura el pedido puede no tener
     permiso para VER el precio, y aun así el costo tiene que quedar. */
  if (input.pagado_en) await fijarCosto(cx.supabase, data.id as string);

  revalidar();
  return { ok: true, datos: { id: data.id as string } };
}

export type PedidoMaquilaEdicion = {
  /* El acabado se corrige POR PEDIDO: los productos "Personalizado" de Tienda
     Nube no lo fijan — el cliente elige sublimado o bordado con gamuza — y la
     ficha de producto solo pone el default. Dixit Armando: en personalizados
     el prensado no existe. */
  acabado: AcabadoMaquilaId;
  palanca_color: ColorPalancaId | null;
  combo: ComboMaquilaId;
  combo_diseno: string;
  talla: string;
  color: string;
  notas: string;
};

/* Corrección de los campos de armado (interno). El color de palanca es el que
   más importa: Tienda Nube no lo trae y alguien tiene que capturarlo antes de
   que Eduardo imprima la ficha. Si cambia el acabado en un pedido ya pagado,
   la clasificación se recalcula ENTERA con las mismas reglas de la ingesta
   (ruta, corte, promesa y tarifa); el trigger de eventos deja constancia de la
   reclasificación. Entre sublimado y bordado la promesa no se mueve —los dos
   van por corte a +10—, así que lo normal es que solo cambie la tarifa. */
export async function editarPedidoMaquila(
  id: string,
  input: PedidoMaquilaEdicion,
): Promise<Resultado> {
  const cx = await exigirRol("interno");
  if ("error" in cx) return cx;

  const cambio: TablesUpdate<"maquila_pedidos"> = {
    acabado: input.acabado,
    palanca_color: input.palanca_color,
    combo: input.combo,
    combo_diseno: textoONulo(input.combo_diseno),
    talla: textoONulo(input.talla),
    color: textoONulo(input.color),
    notas: textoONulo(input.notas),
  };

  const { data: actual, error: errActual } = await cx.supabase
    .from("maquila_pedidos")
    .select("acabado, subestado, pagado_en, modelo")
    .eq("id", id)
    .single();
  if (errActual || !actual) return { error: errActual?.message ?? "Ese pedido ya no existe." };

  const cambioDeAcabado = input.acabado !== actual.acabado;
  if (cambioDeAcabado) {
    /* El subestado es de la ruta por lote; si el acabado sale de esa familia,
       se limpia aquí para no chocar con el CHECK compuesto. */
    if (input.acabado === "prensado" && actual.subestado) cambio.subestado = null;
    if (actual.pagado_en) {
      const { cal } = await cargarCalendarioMaquila(cx.supabase);
      const cls = clasificarPago(
        diaMX(actual.pagado_en),
        horaMX(actual.pagado_en),
        input.acabado,
        cal,
      );
      cambio.ruta = cls.ruta;
      cambio.corte_fecha = cls.corteFecha;
      cambio.fecha_prometida = cls.fechaPrometida;
    }
  }

  const { error } = await cx.supabase.from("maquila_pedidos").update(cambio).eq("id", id);
  if (error) return { error: error.message };

  /* La tarifa cambia con el acabado, y quien corrige un pedido no siempre
     puede leer la tabla de precios: por eso el recálculo lo hace la base
     (maquila_fijar_costo_pedido), después del update y con el acabado nuevo. */
  if (cambioDeAcabado && actual.pagado_en) await fijarCosto(cx.supabase, id);

  revalidar();
  return { ok: true };
}

/* Cancelar y marcar devuelto son decisiones de administración, no de
   producción: la spec se lo reserva a Armando y Diana. */
export async function cancelarPedidoMaquila(
  id: string,
  devuelto = false,
): Promise<Resultado> {
  const cx = await exigirRol("admin");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase
    .from("maquila_pedidos")
    .update({ estado: devuelto ? "devuelto" : "cancelado" })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidar();
  return { ok: true };
}

/* El historial del pedido, con el nombre de quién movió cada cosa. El join a
   profiles pasa por la RLS de la sesión: Eduardo resuelve al equipo de casa y
   nada más; autor null se pinta como "Sistema". */
export async function listarEventosMaquila(
  pedidoId: string,
): Promise<Resultado<{ eventos: EventoMaquila[] }>> {
  const cx = await exigirRol("maquila");
  if ("error" in cx) return cx;

  const { data, error } = await cx.supabase
    .from("maquila_eventos")
    .select("id, pedido_id, autor, tipo, de, a, detalle, created_at, autor_perfil:profiles!autor(nombre)")
    .eq("pedido_id", pedidoId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) return { error: error.message };

  type Fila = EventoMaquila & { autor_perfil: { nombre: string } | null };
  const eventos = ((data ?? []) as unknown as Fila[]).map(({ autor_perfil, ...e }) => ({
    ...e,
    autor_nombre: autor_perfil?.nombre ?? null,
  }));
  return { ok: true, datos: { eventos } };
}
