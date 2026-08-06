import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { veDineroDeCanal } from "@/lib/permisos-dinero";
import { traerTodo } from "@/lib/canales/paginacion";
import { estadoTiktok } from "@/lib/tiktok/api";
import { finanzasTikTok } from "@/lib/tiktok/finanzas";
import { saludCatalogoTikTok, type FichaCanal } from "@/lib/tiktok/salud-catalogo";
import { PanelTikTok, type PesoCanal } from "@/components/canales/panel-tiktok";
import { diasDesdeHoy, hoyISO } from "@/lib/fecha";
import type { ResumenMetricas } from "@/lib/types";

export const metadata = { title: "TikTok Shop · Fresafit" };

/* Ventana del peso del canal. 60 días aguantan la estacionalidad de una tienda
   que vende por contenido, donde una semana buena distorsiona el mes. */
const DIAS = 60;

export default async function TikTokPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase } = await usuarioActual();

  /* Ésta es la pantalla del encargado del canal, así que aquí manda el permiso
     POR CANAL: quien lleva TikTok ve lo que vendió, lo que se llevó la
     plataforma y lo que quedó depositado, aunque no vea los números del resto
     del negocio. La participación es la excepción y se decide más abajo. */
  const dinero = await vistaDinero();
  const verDinero = veDineroDeCanal(dinero, "tiktok_shop");

  /* Anotado como `string` a propósito: el parser de tipos de supabase-js intenta
     leer la lista de columnas del literal, y con una armada al vuelo se rinde
     con un ParserError. Aquí el tipo de la fila lo pone `traerTodo<FichaCanal>`. */
  const columnasFicha: string =
    "id, nombre, variante, sku, stock, tiktok_stock, tiktok_product_id," +
    " tiendanube_product_id, meli_item_id, activo" +
    (verDinero ? ", precio" : "");

  const [fichas, resumenRes, totalRes, estado, finanzas] = await Promise.all([
    /* El catálogo COMPLETO, no solo lo de TikTok: el cruce es por SKU y hacen
       falta las fichas del otro lado para encontrar las partidas y comparar
       precios.

       Paginado, porque el catálogo pasa de 1 000 y PostgREST corta ahí sin
       avisar: leer solo la primera página escondería justo las fichas que no
       entran, que es el error que esta pantalla existe para detectar. */
    /* El `precio` viaja para quien lleva el canal: la comparativa de abajo —el
       mismo SKU a dos precios porque los catálogos están partidos— es
       exactamente su trabajo, y sin precios no existe. */
    traerTodo<FichaCanal>((desde, hasta) =>
      supabase
        .from("products")
        .select(columnasFicha)
        .order("nombre")
        .range(desde, hasta) as unknown as PromiseLike<{
        data: FichaCanal[] | null;
        error: { message: string } | null;
      }>,
    ).catch((e: Error) => {
      console.warn("[canales/tiktok] catálogo no disponible:", e.message);
      return [] as FichaCanal[];
    }),
    /* Lo del canal, ya sumado en la base. Antes esto bajaba las ventas de los
       CINCO canales —60 días de renglones— para sumarlas aquí; ahora la misma
       función que alimenta Métricas hace la cuenta y de paso aplica el permiso:
       al encargado de TikTok le devuelve su importe, y a quien no puede verlo le
       llega en null sin haber viajado. */
    supabase.rpc("metricas_resumen", {
      desde: diasDesdeHoy(-DIAS),
      hasta: hoyISO(),
      canal_f: "tiktok_shop",
    }),
    /* El total del negocio, solo para la participación: es una división entre lo
       de TODOS los canales, así que exige ver los ingresos completos. Para el
       encargado del canal ni se pide. */
    dinero.ingresos
      ? supabase.rpc("metricas_resumen", {
          desde: diasDesdeHoy(-DIAS),
          hasta: hoyISO(),
          canal_f: null,
        })
      : null,
    estadoTiktok(),
    /* Lo que la plataforma cobra. Cacheado 15 min y tolerante a fallo: si TikTok
       no contesta, la página se pinta sin ese bloque. */
    verDinero ? finanzasTikTok(DIAS) : null,
  ]);

  const suyo = (resumenRes.data as ResumenMetricas | null) ?? null;
  const monto = suyo?.kpis.total == null ? null : Number(suyo.kpis.total);
  const totalNegocio = Number(
    ((totalRes?.data as ResumenMetricas | null) ?? null)?.kpis.total ?? 0,
  );

  const peso: PesoCanal = {
    monto,
    piezas: suyo?.kpis.piezas ?? 0,
    renglones: suyo?.kpis.ventas ?? 0,
    participacion:
      monto !== null && totalRes && totalNegocio > 0 ? (monto / totalNegocio) * 100 : null,
    dias: DIAS,
  };

  return (
    <PanelTikTok
      conectada={estado.conectada}
      ultimaSync={estado.ultimaSync}
      salud={saludCatalogoTikTok(fichas)}
      peso={peso}
      finanzas={finanzas}
    />
  );
}
