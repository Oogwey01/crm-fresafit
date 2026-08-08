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
import type { CalendarioMaquila } from "@/lib/maquila/reglas";
import type {
  AcabadoMaquilaId,
  ConfigMaquila,
  CostoMaquila,
  FestivoMaquila,
  ModeloMaquilaId,
} from "@/lib/types";

type Cliente = SupabaseClient<Database>;

/* Columnas explícitas del pedido (ver ARQUITECTURA.md: nada de select("*")).
   Es la fila completa que pintan el tablero y la ficha; lo único que se queda
   fuera es la fontanería (sale_id, producto_id, created_by, updated_at). */
export const COLUMNAS_PEDIDO_MAQUILA =
  "id, canal, referencia_externa, referencia_orden, numero_orden, origen," +
  " sku, diseno, modelo, acabado, talla, color, cantidad," +
  " requiere_palanca, palanca_color, combo, combo_diseno, costo_maquila," +
  " pagado_en, ruta, corte_fecha, fecha_prometida," +
  " terminado_en, enviado_en, entregado_en, estado, subestado," +
  " paqueteria, num_guia, url_rastreo," +
  " envio_nombre, envio_telefono, envio_direccion, notas, created_at";

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
