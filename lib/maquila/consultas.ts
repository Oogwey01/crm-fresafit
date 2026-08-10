/* ============================================================================
   lib/maquila/consultas.ts — Lecturas compartidas del módulo Maquila México
   ----------------------------------------------------------------------------
   Lo que la página, las acciones y la ingesta consultan por igual: las columnas
   explícitas del pedido, el calendario (config + días no hábiles) y la tarifa
   vigente. Recibe el cliente por parámetro porque tiene dos vidas: con sesión
   (la página, donde la RLS recorta por rol) y con service role (la ingesta de
   webhooks/cron, que corre sin persona).
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { traerTodo } from "@/lib/canales/paginacion";
import { traerPorLotes } from "@/lib/supabase/lotes";
import { comprometidoPorInsumo } from "@/lib/maquila/consignacion";
import type { CalendarioMaquila } from "@/lib/maquila/reglas";
import type {
  AcabadoMaquilaId,
  AnticipoMaquila,
  ConfigMaquila,
  CorteMaquila,
  CorteMaquilaConDetalle,
  CostoMaquila,
  DisenoMaquila,
  FestivoMaquila,
  GuiaMaquila,
  InsumoMaquila,
  InsumoMaquilaConSaldo,
  ModeloMaquilaId,
  MovConsignacionMaquila,
  RenglonCorteMaquila,
} from "@/lib/types";

type Cliente = SupabaseClient<Database>;

/* Columnas explícitas del pedido (ver ARQUITECTURA.md: nada de select("*")).
   Es la fila completa que pintan el tablero y la ficha; lo único que se queda
   fuera es la fontanería (sale_id, producto_id, created_by, updated_at). */
export const COLUMNAS_PEDIDO_MAQUILA =
  "id, canal, referencia_externa, referencia_orden, numero_orden, origen," +
  " sku, diseno, modelo, acabado, talla, color, cantidad," +
  " requiere_palanca, palanca_color, combo, combo_diseno," +
  " personalizado_id, diseno_id, diseno_listo_en," +
  " pagado_en, ruta, corte_fecha, fecha_prometida," +
  " terminado_en, enviado_en, entregado_en, estado, subestado," +
  " paqueteria, num_guia, url_rastreo," +
  " envio_nombre, envio_telefono, envio_direccion, notas, created_at";

/* El costo NO viaja con el pedido: vive en `maquila_pedido_costos`, cerrada a
   administración (ver 20260930000000). Se pide aparte y solo cuando quien mira
   ve egresos — así un coordinador nunca lo tiene ni en el payload.
   Devuelve pedido_id → costo unitario. */
export async function cargarCostosDePedidos(
  cliente: Cliente,
  ids: string[],
): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const filas = await traerPorLotes<string, { pedido_id: string; costo: number | null }>(
    ids,
    (lote) =>
      cliente.from("maquila_pedido_costos").select("pedido_id, costo").in("pedido_id", lote),
  );
  const mapa = new Map<string, number>();
  for (const f of filas) if (f.costo !== null) mapa.set(f.pedido_id, f.costo);
  return mapa;
}

/* Columnas de la solicitud de guía (tabla maquila_guias). Sin `notas` de más:
   es la fila entera menos la fontanería de auditoría. */
export const COLUMNAS_GUIA_MAQUILA =
  "id, canal, grupo, estado, paqueteria, num_guia," +
  " archivo_path, archivo_nombre, archivo_mime," +
  " solicitada_en, cargada_por, cargada_en, entregada_en, notas, created_at, updated_at";

/* Las solicitudes VIVAS. Las cerradas no se traen: el histórico de un envío se
   lee desde el pedido, que ya guarda paquetería y número. El cruce guía↔pedidos
   se hace en memoria por (canal, grupo) — no hay FK porque la guía es del
   paquete y el pedido del renglón. */
export async function cargarGuiasMaquila(cliente: Cliente): Promise<GuiaMaquila[]> {
  return traerTodo<GuiaMaquila>((desde, hasta) =>
    cliente
      .from("maquila_guias")
      .select(COLUMNAS_GUIA_MAQUILA)
      .in("estado", ["solicitada", "cargada"])
      .order("solicitada_en", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta),
  );
}

/* El material en poder de Eduardo: catálogo + saldo, con el comprometido ya
   calculado a partir de los pedidos vivos. Dos consultas y no un join porque
   `maquila_consignacion` es una tabla de una columna útil y así el orden lo
   manda el catálogo (que es como se lee la pantalla). */
export async function cargarConsignacionMaquila(
  cliente: Cliente,
  pedidos: Parameters<typeof comprometidoPorInsumo>[0],
): Promise<InsumoMaquilaConSaldo[]> {
  const [insumosRes, saldosRes] = await Promise.all([
    cliente
      .from("maquila_insumos")
      .select("id, clave, nombre, unidad, producto_id, minimo, activo, notas, created_by, created_at, updated_at")
      .order("clave"),
    cliente.from("maquila_consignacion").select("insumo_id, saldo"),
  ]);
  if (insumosRes.error) throw new Error(insumosRes.error.message);
  if (saldosRes.error) throw new Error(saldosRes.error.message);

  const saldos = new Map(
    ((saldosRes.data ?? []) as { insumo_id: string; saldo: number }[]).map((s) => [
      s.insumo_id,
      s.saldo,
    ]),
  );
  const comprometido = comprometidoPorInsumo(pedidos);

  return ((insumosRes.data ?? []) as InsumoMaquila[]).map((i) => ({
    ...i,
    saldo: saldos.get(i.id) ?? 0,
    comprometido: comprometido.get(i.clave) ?? 0,
  }));
}

/* La bitácora reciente del material, con el nombre de quién movió cada cosa.
   Acotada: es un historial de consulta, no un ledger que se exporte. */
export async function cargarMovsConsignacion(
  cliente: Cliente,
  limite = 200,
): Promise<MovConsignacionMaquila[]> {
  const { data, error } = await cliente
    .from("maquila_consignacion_movs")
    .select(
      "id, insumo_id, tipo, cantidad, saldo_resultante, pedido_id, lote, motivo, created_by, created_at," +
        " autor_perfil:profiles!created_by(nombre), insumo:maquila_insumos!insumo_id(nombre)",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);

  type Fila = MovConsignacionMaquila & {
    autor_perfil: { nombre: string } | null;
    insumo: { nombre: string } | null;
  };
  return ((data ?? []) as unknown as Fila[]).map(({ autor_perfil, insumo, ...m }) => ({
    ...m,
    autor_nombre: autor_perfil?.nombre ?? null,
    insumo_nombre: insumo?.nombre ?? null,
  }));
}

/* La biblioteca de artes de colección. Chica por naturaleza (decenas de
   diseños por temporada), así que sin paginar. */
export async function cargarDisenosMaquila(cliente: Cliente): Promise<DisenoMaquila[]> {
  const { data, error } = await cliente
    .from("maquila_disenos")
    .select(
      "id, nombre, coleccion, acabado, archivo_path, archivo_nombre, archivo_mime," +
        " activo, notas, created_by, created_at, updated_at",
    )
    .order("coleccion", { nullsFirst: false })
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as DisenoMaquila[];
}

/* --- El dinero (solo lo alcanza administración; la RLS hace el corte) ------ */

export const COLUMNAS_CORTE_MAQUILA =
  "id, periodo_desde, periodo_hasta, estado, piezas, subtotal, iva_tasa, iva," +
  " anticipos_aplicados, total, cerrado_en, cerrado_por, pagado_en, pagado_por," +
  " metodo_pago, factura_folio, factura_uuid, factura_path, expense_id, notas," +
  " created_by, created_at, updated_at";

/* Los cortes recientes con sus renglones. Sin paginar la lista de cortes (son
   24 al año); los renglones sí van por lotes de ids. */
export async function cargarCortesMaquila(
  cliente: Cliente,
  limite = 12,
): Promise<CorteMaquilaConDetalle[]> {
  const { data, error } = await cliente
    .from("maquila_cortes")
    .select(COLUMNAS_CORTE_MAQUILA)
    .order("periodo_desde", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);

  /* Doble cast como en listarEventosMaquila: con la lista de columnas en una
     constante concatenada, PostgREST-js no puede inferir la fila y devuelve su
     tipo de error genérico. */
  const cortes = (data ?? []) as unknown as CorteMaquila[];
  if (!cortes.length) return [];

  const renglones = await traerPorLotes<string, RenglonCorteMaquila>(
    cortes.map((c) => c.id),
    (lote) =>
      cliente
        .from("maquila_corte_renglones")
        .select(
          "id, corte_id, pedido_id, concepto, modelo, acabado, cantidad, costo_unitario," +
            " importe, enviado_en, anulado, created_at",
        )
        .in("corte_id", lote)
        .eq("anulado", false),
  );

  return cortes.map((c) => ({
    ...c,
    renglones: renglones.filter((r) => r.corte_id === c.id),
  }));
}

/* Los anticipos con su saldo derivado (vista maquila_anticipos_saldo). */
export async function cargarAnticiposMaquila(cliente: Cliente): Promise<AnticipoMaquila[]> {
  const [anticiposRes, saldosRes] = await Promise.all([
    cliente
      .from("maquila_anticipos")
      .select(
        "id, fecha, tipo, concepto, monto, especie_cantidad, especie_unidad," +
          " comprobante_path, comprobante_nombre, notas, created_by, created_at, updated_at",
      )
      .order("fecha", { ascending: false })
      .order("id", { ascending: false }),
    cliente.from("maquila_anticipos_saldo").select("anticipo_id, aplicado, saldo"),
  ]);
  if (anticiposRes.error) throw new Error(anticiposRes.error.message);
  if (saldosRes.error) throw new Error(saldosRes.error.message);

  const saldos = new Map(
    ((saldosRes.data ?? []) as { anticipo_id: string; aplicado: number; saldo: number }[]).map(
      (s) => [s.anticipo_id, s],
    ),
  );
  return ((anticiposRes.data ?? []) as unknown as AnticipoMaquila[]).map((a) => ({
    ...a,
    aplicado: saldos.get(a.id)?.aplicado ?? 0,
    saldo: saldos.get(a.id)?.saldo ?? a.monto,
  }));
}

/* La configuración y los días no hábiles, ya en la forma que pide
   lib/maquila/reglas.ts. `hora_limite` llega de Postgres como "13:00:00";
   se recorta a "HH:mm" para que compare bien contra horaMX(). */
export async function cargarCalendarioMaquila(cliente: Cliente): Promise<{
  config: ConfigMaquila;
  festivos: FestivoMaquila[];
  cal: CalendarioMaquila;
}> {
  const [configRes, festivosRes] = await Promise.all([
    cliente.from("maquila_config").select("id, hora_limite, sabado_habil, updated_by, updated_at").eq("id", 1).single(),
    /* Sin paginar a propósito: son ~14 festivos al año más los cierres del
       taller — si esta tabla llega a mil filas, algo mucho más raro pasó. */
    cliente.from("maquila_festivos").select("fecha, tipo, motivo, created_by, created_at").order("fecha"),
  ]);
  if (configRes.error) throw new Error(configRes.error.message);
  if (festivosRes.error) throw new Error(festivosRes.error.message);

  const config = configRes.data as ConfigMaquila;
  const festivos = (festivosRes.data ?? []) as FestivoMaquila[];
  return {
    config,
    festivos,
    cal: {
      horaLimite: config.hora_limite.slice(0, 5),
      sabadoHabil: config.sabado_habil,
      noHabiles: new Set(festivos.map((f) => f.fecha)),
    },
  };
}

/* Todas las tarifas, para resolver la vigente en memoria (la tabla es chica y
   la ingesta la necesita para varias piezas de una misma pasada). */
export async function listarCostosMaquila(cliente: Cliente): Promise<CostoMaquila[]> {
  const { data, error } = await cliente
    .from("maquila_costos")
    .select("id, modelo, acabado, costo, vigente_desde, created_by, created_at")
    .order("vigente_desde", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CostoMaquila[];
}

/* La tarifa que rige para un modelo+acabado en una fecha: la última con
   vigencia anterior o igual. Null si no hay ninguna — el pedido queda sin
   costo y la pantalla lo señala, mejor que inventar un cero. */
export function costoVigente(
  costos: CostoMaquila[],
  modelo: ModeloMaquilaId,
  acabado: AcabadoMaquilaId,
  fecha: string,
): number | null {
  let mejor: CostoMaquila | null = null;
  for (const c of costos) {
    if (c.modelo !== modelo || c.acabado !== acabado) continue;
    if (c.vigente_desde > fecha) continue;
    if (!mejor || c.vigente_desde > mejor.vigente_desde) mejor = c;
  }
  return mejor?.costo ?? null;
}
