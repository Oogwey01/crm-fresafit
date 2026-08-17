/* ============================================================================
   lib/personalizados/desde-maquila.ts — La ficha del personalizado se crea sola
   ----------------------------------------------------------------------------
   Un cinturón personalizado vendido por un canal ya entra al tablero de Eduardo
   (lib/maquila/ingesta.ts), pero el ARTE lo hace el diseñador, y para eso
   necesita una ficha en /personalizados. Capturarla a mano tenía dos costes:
   alguien tenía que acordarse, y el folio se tecleaba — la hoja histórica está
   llena de números que no existen en el CRM (`#7828` cuando Tienda Nube va por
   el 1149), así que nunca cruzaron con nada.

   Aquí la ficha nace DE la venta y se liga al pedido en el mismo acto. Eso quita
   de raíz la ambigüedad que tiene el cruce por texto: dos cinturones distintos
   en la misma orden son dos pedidos de maquila, y cada uno estrena su ficha. El
   diseñador ya solo busca, sube el arte y sigue.

   Idempotente sin tabla de control: la condición de alta es
   `maquila_pedidos.personalizado_id is null`, y ligar es lo último que se hace.
   Correrlo dos veces no crea nada la segunda.

   NO toca las 166 fichas viejas de la hoja de Diana: no comparten folio con
   nada del CRM y son el archivo de lo ya producido.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/tipos-bd";
import { traerPorLotes } from "@/lib/supabase/lotes";
import { diaMX } from "@/lib/fecha";
import { fechaLimitePersonalizado } from "@/lib/personalizados/plazo";
import { urlOrdenCanal } from "@/lib/pedidos/rastreo";
import type { AcabadoMaquilaId, ModeloMaquilaId } from "@/lib/types";

type Cliente = SupabaseClient<Database>;

/* Cuántos pedidos se miran de una pasada. Alto para que el primer arranque
   —que arrastra el histórico— quepa entero, y acotado para que un día raro no
   convierta la sync en una migración. */
const TOPE = 500;

/* El acabado de maquila dicho como lo dice la hoja de personalizados. La
   gamuza es un bordado sobre otro material, no un tercer tipo. */
const TIPO_POR_ACABADO: Record<AcabadoMaquilaId, "bordado" | "sublimado" | "otro"> = {
  sublimado: "sublimado",
  bordado: "bordado",
  bordado_gamuza: "bordado",
  prensado: "otro",
};

/* `personalizados.canal` no conoce el canal "manual" de maquila. */
function canalDeFicha(canal: string): "tienda_nube" | "mercado_libre" | "tiktok_shop" | "otro" {
  return canal === "tienda_nube" || canal === "mercado_libre" ? canal : "otro";
}

type PedidoSinFicha = {
  id: string;
  canal: string;
  referencia_orden: string | null;
  numero_orden: string | null;
  modelo: ModeloMaquilaId;
  acabado: AcabadoMaquilaId;
  talla: string | null;
  envio_nombre: string | null;
  pagado_en: string | null;
  created_at: string;
};

/* Los pedidos de maquila que son personalizados y todavía no tienen ficha.
   «Personalizado» es `products.bajo_pedido`, la marca que ya existe en el
   catálogo (20260724000000: los SKU PRMPER/SBDPER y lo que se llame así), y no
   una lista de SKU repetida aquí. */
async function pedidosSinFicha(supabase: Cliente): Promise<PedidoSinFicha[]> {
  const { data, error } = await supabase
    .from("maquila_pedidos")
    .select(
      "id, canal, referencia_orden, numero_orden, modelo, acabado, talla, envio_nombre," +
        " pagado_en, created_at," +
        " producto:products!inner(bajo_pedido)",
    )
    .is("personalizado_id", null)
    .eq("producto.bajo_pedido", true)
    .neq("estado", "cancelado")
    .order("created_at", { ascending: true })
    .limit(TOPE);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PedidoSinFicha[];
}

/* (canal, referencia_orden) → id de la orden, para dejar la ficha colgada de la
   venta de verdad y no solo del folio tecleado (20261006000000). */
async function ordenesPorReferencia(
  supabase: Cliente,
  pedidos: PedidoSinFicha[],
): Promise<Map<string, string>> {
  const refs = [...new Set(pedidos.map((p) => p.referencia_orden).filter(Boolean))] as string[];
  if (!refs.length) return new Map();
  const { data } = await supabase
    .from("sale_orders")
    .select("id, canal, referencia_orden")
    .in("referencia_orden", refs);
  return new Map(
    ((data ?? []) as { id: string; canal: string; referencia_orden: string }[]).map((o) => [
      `${o.canal}:${o.referencia_orden}`,
      o.id,
    ]),
  );
}

/* --- La venta en el panel del canal ---------------------------------------- */

export type EnlaceOrden = { url: string; canal: string };

/* El detalle de la venta en el panel de la tienda —donde se lee qué pidió el
   cliente—, no la ficha pública del producto. La URL la arma `urlOrdenCanal`,
   la misma que usa /pedidos: así hay UN solo lugar donde vive la forma del
   enlace de cada canal, y el día que Tienda Nube cambie su panel se corrige una
   vez.

   Se llega por el pedido de maquila, que es lo único que ata una ficha con su
   orden: `personalizados` guarda el folio visible ("1042") y el panel se abre
   con el id interno ("2005692741"). Las fichas viejas de la hoja no tienen
   pedido ligado y se quedan sin botón: su folio no existe en el CRM. */
export async function enlacesDeOrden(
  supabase: Cliente,
  personalizadoIds: string[],
  dominioTiendaNube: string | null,
): Promise<Map<string, EnlaceOrden>> {
  const mapa = new Map<string, EnlaceOrden>();
  if (!personalizadoIds.length) return mapa;

  type Fila = { personalizado_id: string; canal: string; referencia_orden: string | null };
  const filas = await traerPorLotes<string, Fila>(personalizadoIds, (lote) =>
    supabase
      .from("maquila_pedidos")
      .select("personalizado_id, canal, referencia_orden")
      .in("personalizado_id", lote),
  );

  for (const f of filas) {
    if (!f.referencia_orden || mapa.has(f.personalizado_id)) continue;
    const url = urlOrdenCanal(f.canal, f.referencia_orden, dominioTiendaNube);
    if (url) mapa.set(f.personalizado_id, { url, canal: f.canal });
  }
  return mapa;
}

export type ResumenSiembraPersonalizados = { creadas: number };

export async function sembrarPersonalizadosDeMaquila(
  supabase: Cliente,
): Promise<ResumenSiembraPersonalizados> {
  const pedidos = await pedidosSinFicha(supabase);
  if (!pedidos.length) return { creadas: 0 };

  const ordenes = await ordenesPorReferencia(supabase, pedidos);
  let creadas = 0;

  /* Una por una y no en lote: cada ficha tiene que quedar ligada a SU pedido, y
     un insert masivo devuelve los ids sin decir de quién es cada uno. Son
     decenas en el primer arranque y unidades después. */
  for (const p of pedidos) {
    /* El día en que entró el cinto: de él cuelgan la cola de la pantalla y la
       promesa al cliente, así que se calcula una vez y se usa para las dos. */
    const ingreso = diaMX(p.pagado_en ?? p.created_at);
    const { data: ficha, error } = await supabase
      .from("personalizados")
      .insert({
        cliente: p.envio_nombre?.trim() || "Sin nombre",
        tipo: TIPO_POR_ACABADO[p.acabado] ?? null,
        modelo: p.modelo, // powerlift / hebilla: el vocabulario coincide
        talla: p.talla,
        no_venta: p.numero_orden,
        canal: canalDeFicha(p.canal),
        fecha_compra: ingreso,
        /* La promesa AL CLIENTE: 33 días naturales desde el ingreso
           (lib/personalizados/plazo.ts). Aquí se copiaba `fecha_prometida`, que
           es la promesa del TALLER —7/10 días hábiles— y mide otra cosa: las
           fichas nacían con ~12 días de límite y el módulo las daba por fuera
           de fecha cuando todavía les sobraban tres semanas. */
        fecha_limite: fechaLimitePersonalizado(ingreso),
        sale_order_id: ordenes.get(`${p.canal}:${p.referencia_orden}`) ?? null,
        estado: "recibido",
        notas: "Alta automática desde la venta: falta el arte.",
      })
      .select("id")
      .single();
    if (error || !ficha) continue; // el pedido se queda sin ficha y vuelve a intentarse

    /* Ligar es lo ÚLTIMO: mientras no pase, este pedido sigue elegible, así que
       un fallo a medias deja una ficha huérfana —visible y borrable— en vez de
       un pedido marcado que nadie volverá a mirar. El `is null` protege de que
       dos pasadas simultáneas ligaran cosas distintas. */
    const { error: errLiga } = await supabase
      .from("maquila_pedidos")
      .update({ personalizado_id: ficha.id as string })
      .eq("id", p.id)
      .is("personalizado_id", null);
    if (errLiga) {
      await supabase.from("personalizados").delete().eq("id", ficha.id as string);
      continue;
    }
    creadas++;
  }

  return { creadas };
}
